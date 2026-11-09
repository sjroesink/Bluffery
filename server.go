package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	_ "modernc.org/sqlite"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const sessionCookie = "vissig"

// maxTurns caps turns per player; with 10 players this already needs 50 unused questions.
const maxTurns = 5

type Player struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Score int    `json:"score"`
}
type Room struct {
	Code     string            `json:"code"`
	Host     string            `json:"host"`
	Version  int               `json:"version"`
	Phase    string            `json:"phase"`
	Players  []Player          `json:"players"`
	Turns    int               `json:"turns"`
	Turn     int               `json:"turn"`
	Question *Question         `json:"question,omitempty"`
	Roles    map[string]string `json:"roles,omitempty"`
	Revealed map[string]bool   `json:"revealed,omitempty"`
	Kept     map[string]bool   `json:"kept,omitempty"`
	Used     []string          `json:"used"`
	Result   string            `json:"result,omitempty"`
	Gains    map[string]int    `json:"gains,omitempty"`
	Skips    bool              `json:"skips,omitempty"`
}
type Command struct {
	ID      string `json:"id"`
	Action  string `json:"action"`
	Name    string `json:"name,omitempty"`
	Code    string `json:"code,omitempty"`
	Version int    `json:"version"`
	Target  string `json:"target,omitempty"`
	Turns   int    `json:"turns,omitempty"`
	Skips   bool   `json:"skips,omitempty"`
}
type Server struct {
	db           *sql.DB
	origin       string
	legacyOrigin string
	questions    []Question
	proxies      []*net.IPNet
	static       http.Handler
	eventsHub    eventHub
}

func random(n int) string {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func hash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func openServer(dir, origin string, fixtures bool) (*Server, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	if e := os.Chmod(dir, 0700); e != nil {
		return nil, e
	}
	// Keep the pre-rename file and cookie names: renaming them would drop live games and sessions.
	p := filepath.Join(dir, "vissig.sqlite")
	f, e := os.OpenFile(p, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	f.Close()
	if e = os.Chmod(p, 0600); e != nil {
		return nil, e
	}
	db, e := sql.Open("sqlite", p)
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	_, e = db.Exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA max_page_count=65536; PRAGMA journal_size_limit=8388608; PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, room TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS commands(actor TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,room TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(actor,id));
 CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,data TEXT NOT NULL);`)
	if e != nil {
		db.Close()
		return nil, e
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if e = os.Chmod(p+suffix, 0600); e != nil && !os.IsNotExist(e) {
			db.Close()
			return nil, e
		}
	}
	s := &Server{db: db, origin: strings.TrimRight(origin, "/")}
	s.questions, e = loadCatalog(fixtures)
	if e != nil {
		db.Close()
		return nil, e
	}
	if e = s.importCatalog(); e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Server) importCatalog() error {
	// Validate the entire authoritative seed before starting any catalog writes.
	b, e := json.Marshal(Catalog{SchemaVersion: 1, Questions: s.questions})
	if e != nil {
		return e
	}
	if _, e = validateCatalog(b); e != nil {
		return e
	}
	if len(s.questions) < 20 {
		return fmt.Errorf("approved seed requires at least 20 questions for a maximal game")
	}
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	active := map[string]bool{}
	for _, q := range s.questions {
		active[q.ID] = true
		b, _ := json.Marshal(q)
		if _, e = tx.Exec(`INSERT INTO catalog VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, q.ID, string(b)); e != nil {
			return e
		}
	}
	rows, e := tx.Query(`SELECT id FROM catalog`)
	if e != nil {
		return e
	}
	var retired []string
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		if !active[id] {
			retired = append(retired, id)
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	// Rooms own immutable dealt snapshots and historical used IDs; never rewrite them.
	for _, id := range retired {
		if _, e = tx.Exec(`DELETE FROM catalog WHERE id=?`, id); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func fail(w http.ResponseWriter, status int, msg string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
func validName(s string) bool {
	if s != strings.TrimSpace(s) || utf8.RuneCountInString(s) < 1 || utf8.RuneCountInString(s) > 24 {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return false
		}
	}
	return true
}

var idRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,80}$`)
var codeRE = regexp.MustCompile(`^[A-F0-9]{6}$`)

func (s *Server) session(r *http.Request) string {
	c, e := r.Cookie(sessionCookie)
	if e != nil || len(c.Value) != 64 {
		return ""
	}
	h := hash(c.Value)
	var x string
	e = s.db.QueryRow(`SELECT hash FROM sessions WHERE hash=? AND expires>?`, h, time.Now().Unix()).Scan(&x)
	if e != nil {
		return ""
	}
	return h
}
func (s *Server) clientIP(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	for _, n := range s.proxies {
		if n.Contains(ip) {
			if v := net.ParseIP(r.Header.Get("X-Forwarded-For")); v != nil {
				return v.String()
			}
			break
		}
	}
	return host
}
func (s *Server) allow(r *http.Request, bucket string, max int, period int64) bool {
	now := time.Now().Unix()
	key := hash(s.clientIP(r)) + ":" + bucket + fmt.Sprint(now/period)
	tx, e := s.db.Begin()
	if e != nil {
		return false
	}
	defer tx.Rollback()
	_, e = tx.Exec(`DELETE FROM limits WHERE expires<?`, now)
	if e != nil {
		return false
	}
	var n int
	tx.QueryRow(`SELECT n FROM limits WHERE key=?`, key).Scan(&n)
	if n >= max {
		return false
	}
	_, e = tx.Exec(`INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1`, key, now+period*2)
	if e != nil {
		return false
	}
	return tx.Commit() == nil
}
func (s *Server) cleanup(now int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Bind each cutoff to its own statement; positional parameters restart
	// at each statement in a multi-statement SQLite Exec.
	for _, deletion := range []struct {
		query  string
		cutoff int64
	}{
		{`DELETE FROM sessions WHERE expires<?`, now},
		{`DELETE FROM commands WHERE created<?`, now - 86400*7},
		{`DELETE FROM rooms WHERE expires<?`, now},
	} {
		if _, err := tx.Exec(deletion.query, deletion.cutoff); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Match only configured origins, never the request Host or forwarding headers.
func (s *Server) allowedOrigin(origin string) bool {
	return origin == s.origin || (s.legacyOrigin != "" && origin == s.legacyOrigin)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
	if r.URL.Path == "/healthz" {
		if s.db.Ping() != nil {
			http.Error(w, "unavailable", 503)
		} else {
			io.WriteString(w, "ok")
		}
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		if s.static != nil {
			s.static.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Cloudflare-CDN-Cache-Control", "no-store")
	if r.Method != "GET" && (!s.allowedOrigin(r.Header.Get("Origin")) || r.Header.Get("Sec-Fetch-Site") == "cross-site") {
		fail(w, 403, "Alleen vanuit Bluffery toegestaan.")
		return
	}
	if r.URL.Path == "/api/session" && r.Method == "GET" {
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" || (r.Header.Get("Origin") != "" && !s.allowedOrigin(r.Header.Get("Origin"))) {
			fail(w, 403, "Alleen vanuit Bluffery toegestaan.")
			return
		}
		if s.session(r) == "" {
			if !s.allow(r, "session", 120, 3600) {
				w.Header().Set("Retry-After", "3600")
				fail(w, 429, "Probeer later opnieuw.")
				return
			}
			token := random(32)
			now := time.Now().Unix()
			e := s.cleanup(now)
			if e != nil {
				fail(w, 503, "Opslag tijdelijk niet beschikbaar.")
				return
			}
			var n int
			s.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&n)
			if n >= 20000 {
				fail(w, 503, "Het is even te druk.")
				return
			}
			_, e = s.db.Exec(`INSERT INTO sessions(hash,expires) VALUES(?,?)`, hash(token), now+86400*7)
			if e != nil {
				fail(w, 503, "Opslag tijdelijk niet beschikbaar.")
				return
			}
			http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(s.origin, "https://"), SameSite: http.SameSiteStrictMode, MaxAge: 86400 * 7})
		}
		io.WriteString(w, `{"ok":true}`)
		return
	}
	actor := s.session(r)
	if actor == "" {
		fail(w, 404, "Geen actieve kamer gevonden.")
		return
	}
	if r.URL.Path == "/api/events" && r.Method == "GET" {
		s.events(w, r, actor)
		return
	}
	if r.URL.Path == "/api/state" && r.Method == "GET" {
		room, e := s.readRoom(actor)
		if e != nil {
			fail(w, 404, "Geen actieve kamer gevonden.")
			return
		}
		json.NewEncoder(w).Encode(project(room, actor))
		return
	}
	if r.URL.Path != "/api/command" || r.Method != "POST" {
		fail(w, 404, "Niet gevonden.")
		return
	}
	if !s.allow(r, "command", 900, 60) {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "Even rustig aan. Probeer zo opnieuw.")
		return
	}
	typ, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if e != nil || typ != "application/json" {
		fail(w, 415, "Verwacht JSON.")
		return
	}
	var c Command
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048))
	d.DisallowUnknownFields()
	if e = d.Decode(&c); e != nil {
		fail(w, 400, "Ongeldig verzoek.")
		return
	}
	if d.Decode(new(any)) != io.EOF || !idRE.MatchString(c.ID) {
		fail(w, 400, "Ongeldig verzoek.")
		return
	}
	status, msg := s.command(actor, c)
	if status != 200 {
		fail(w, status, msg)
		return
	}
	if c.Action == "leave" {
		json.NewEncoder(w).Encode(map[string]bool{"left": true})
		return
	}
	room, e := s.readRoom(actor)
	if e != nil {
		fail(w, 404, "Geen actieve kamer gevonden.")
		return
	}
	json.NewEncoder(w).Encode(project(room, actor))
}
func (s *Server) readRoom(actor string) (Room, error) {
	var b string
	err := s.db.QueryRow(`SELECT r.data FROM rooms r JOIN sessions s ON s.room=r.code WHERE s.hash=? AND s.expires>? AND r.expires>?`, actor, time.Now().Unix(), time.Now().Unix()).Scan(&b)
	var room Room
	if err != nil {
		return room, err
	}
	err = json.Unmarshal([]byte(b), &room)
	if !member(room, actor) {
		return room, errors.New("nonmember")
	}
	return room, err
}
func member(r Room, a string) bool {
	for _, p := range r.Players {
		if p.ID == a {
			return true
		}
	}
	return false
}
func publicID(actor string) string { return actor[:24] }
func project(r Room, a string) map[string]any {
	players := make([]Player, len(r.Players))
	copy(players, r.Players)
	for i := range players {
		players[i].ID = publicID(players[i].ID)
	}
	v := map[string]any{"code": r.Code, "version": r.Version, "phase": r.Phase, "players": players, "host": publicID(r.Host), "me": publicID(a), "turns": r.Turns, "turn": r.Turn, "totalTurns": len(r.Players) * r.Turns, "skips": r.Skips}
	if r.Phase != "lobby" {
		v["guesser"] = publicID(r.Players[r.Turn%len(r.Players)].ID)
	}
	if r.Question != nil {
		v["question"] = r.Question.Question
		v["category"] = r.Question.Category
		v["provisional"] = redCount(r)
		revealed := map[string]string{}
		kept := map[string]bool{}
		for id, yes := range r.Kept {
			kept[publicID(id)] = yes
		}
		for id, yes := range r.Revealed {
			if yes {
				revealed[publicID(id)] = r.Roles[id]
			}
		}
		v["revealed"] = revealed
		v["kept"] = kept
		settled := r.Phase == "settled"
		if a != r.Players[r.Turn%len(r.Players)].ID || settled {
			v["answer"] = r.Question.Answer
		}
		if !settled && a != r.Players[r.Turn%len(r.Players)].ID {
			v["role"] = r.Roles[a]
		}
		if settled {
			roles := map[string]string{}
			gains := map[string]int{}
			for id, role := range r.Roles {
				roles[publicID(id)] = role
			}
			for id, n := range r.Gains {
				gains[publicID(id)] = n
			}
			v["roles"] = roles
			v["gains"] = gains
			v["sources"] = r.Question.Sources
			v["explanation"] = r.Question.Explanation
			v["result"] = r.Result
		}
	}
	return v
}
func (s *Server) command(actor string, c Command) (int, string) {
	tx, e := s.db.Begin()
	if e != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	defer tx.Rollback()
	payload, _ := json.Marshal(c)
	var prior, code string
	e = tx.QueryRow(`SELECT payload,room FROM commands WHERE actor=? AND id=?`, actor, c.ID).Scan(&prior, &code)
	if e == nil {
		if prior != string(payload) {
			return 409, "Verzoek-ID al gebruikt voor een andere actie."
		}
		return 200, ""
	}
	if e != sql.ErrNoRows {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	var actorCount, totalCount int
	if err := tx.QueryRow(`SELECT count(*) FROM commands WHERE actor=?`, actor).Scan(&actorCount); err != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	if actorCount >= 5000 {
		return 429, "Te veel acties in deze sessie. Probeer later opnieuw."
	}
	if err := tx.QueryRow(`SELECT count(*) FROM commands`).Scan(&totalCount); err != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	if totalCount >= 200000 {
		return 507, "De tijdelijke spelopslag is vol."
	}
	var room Room
	var raw, current string
	if e = tx.QueryRow(`SELECT room FROM sessions WHERE hash=? AND expires>?`, actor, time.Now().Unix()).Scan(&current); e != nil {
		return 404, "Geen actieve kamer gevonden."
	}
	if c.Action == "create" {
		if !validName(c.Name) {
			return 400, "Kies een naam van 1–24 zichtbare tekens."
		}
		if current != "" {
			return 409, "Je zit al in een kamer."
		}
		var n int
		tx.QueryRow(`SELECT count(*) FROM rooms`).Scan(&n)
		if n >= 2000 {
			return 503, "Alle tafels zijn bezet."
		}
		room = Room{Code: strings.ToUpper(random(3)), Host: actor, Version: 1, Phase: "lobby", Turns: 0, Players: []Player{{ID: actor, Name: c.Name}}}
	}
	if c.Action != "create" {
		if c.Action == "join" {
			if !codeRE.MatchString(c.Code) || !validName(c.Name) {
				return 400, "Controleer je kamercode en naam."
			}
			if current != "" {
				return 409, "Je zit al in een kamer."
			}
			current = c.Code
		}
		e = tx.QueryRow(`SELECT data FROM rooms WHERE code=? AND expires>?`, current, time.Now().Unix()).Scan(&raw)
		if e != nil {
			return 404, "Geen actieve kamer gevonden."
		}
		if json.Unmarshal([]byte(raw), &room) != nil {
			return 503, "Opslag tijdelijk niet beschikbaar."
		}
		if c.Action == "join" {
			if room.Phase != "lobby" {
				return 409, "Dit spel is al begonnen; aansluiten kan alleen in de lobby."
			}
			if len(room.Players) >= 10 {
				return 409, "Deze kamer is vol (maximaal 10)."
			}
			room.Players = append(room.Players, Player{ID: actor, Name: c.Name})
			room.Version++
		} else {
			if !member(room, actor) {
				return 404, "Geen actieve kamer gevonden."
			}
			if c.Version != room.Version {
				return 409, "De tafel is veranderd. Bekijk de nieuwe stand en probeer opnieuw."
			}
			status, msg := s.transition(&room, actor, c)
			if status != 200 {
				return status, msg
			}
			if c.Action == "remove" {
				_, e = tx.Exec(`UPDATE sessions SET room='' WHERE room=? AND substr(hash,1,24)=?`, room.Code, c.Target)
				if e != nil {
					return 503, "Opslag tijdelijk niet beschikbaar."
				}
			}
			room.Version++
		}
	}
	if len(room.Players) == 0 {
		_, e = tx.Exec(`DELETE FROM rooms WHERE code=?`, room.Code)
	} else {
		e = saveRoom(tx, room, c.Action == "create")
	}
	if e != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	seat := room.Code
	if c.Action == "leave" {
		seat = ""
	}
	_, e = tx.Exec(`UPDATE sessions SET room=? WHERE hash=?`, seat, actor)
	if e != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	_, e = tx.Exec(`INSERT INTO commands VALUES(?,?,?,?,?)`, actor, c.ID, string(payload), room.Code, time.Now().Unix())
	if e != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	if tx.Commit() != nil {
		return 503, "Opslag tijdelijk niet beschikbaar."
	}
	s.eventsHub.notify(room)
	return 200, ""
}
func (s *Server) transition(r *Room, a string, c Command) (int, string) {
	host := a == r.Host
	guesser := r.Players[r.Turn%len(r.Players)].ID
	switch c.Action {
	case "start":
		if !host || r.Phase != "lobby" {
			return 403, "Alleen de host kan starten vanuit de lobby."
		}
		if len(r.Players) < 4 {
			return 409, "Er zijn minimaal 4 spelers nodig."
		}
		if r.Turns == 0 {
			r.Turns = 1
			if len(r.Players) <= 5 {
				r.Turns = 2
			}
		}
		used := map[string]bool{}
		for _, id := range r.Used {
			used[id] = true
		}
		available := 0
		for _, q := range s.questions {
			if !used[q.ID] {
				available++
			}
		}
		if available < len(r.Players)*r.Turns {
			return 409, "Niet genoeg ongebruikte vragen voor dit spel."
		}
		r.Phase = "ready"
	case "configure":
		if !host || r.Phase != "lobby" {
			return 403, "Alleen de host in de lobby."
		}
		if c.Turns < 1 || c.Turns > maxTurns {
			return 400, fmt.Sprintf("Kies 1 tot en met %d beurten.", maxTurns)
		}
		r.Turns = c.Turns
	case "allow-skips":
		if !host || r.Phase == "finished" {
			return 403, "Alleen de host tijdens het spel."
		}
		r.Skips = c.Skips
	case "remove":
		if !host {
			return 403, "Alleen de host kan spelers verwijderen."
		}
		target := ""
		for _, p := range r.Players {
			if publicID(p.ID) == c.Target && p.ID != r.Host {
				target = p.ID
			}
		}
		if target == "" {
			return 400, "Kies een andere speler."
		}
		dropPlayer(r, target)
	case "leave":
		dropPlayer(r, a)
	case "deal":
		if a != guesser || r.Phase != "ready" {
			return 403, "Alleen de rader kan nu uitdelen."
		}
		return s.deal(r, guesser)
	case "skip":
		if a != guesser || r.Phase != "playing" || !r.Skips {
			return 403, "Overslaan kan nu niet."
		}
		if len(r.Revealed) > 0 {
			return 409, "Na een Bluf! ligt de vraag vast."
		}
		// The skipped question stays in Used so it never comes back.
		return s.deal(r, guesser)
	case "keep", "reveal", "bank":
		if r.Revealed == nil {
			r.Revealed = map[string]bool{}
		}
		if r.Kept == nil {
			r.Kept = map[string]bool{}
		}
		if a != guesser || r.Phase != "playing" {
			return 403, "Alleen de rader kan dit tijdens de beurt."
		}
		if c.Action == "bank" {
			settle(r, "bank")
			break
		}
		target := ""
		for _, p := range r.Players {
			if publicID(p.ID) == c.Target {
				target = p.ID
			}
		}
		if target == "" || target == guesser || r.Revealed[target] {
			return 409, "Kies iemand die nog niet is omgedraaid."
		}
		if c.Action == "keep" {
			r.Kept[target] = !r.Kept[target]
			break
		}
		r.Revealed[target] = true
		if r.Roles[target] == "blue" {
			if redCount(*r) == len(r.Players)-2 {
				settle(r, "last-blue")
			} else {
				settle(r, "bust")
			}
		}
	case "next":
		if a != guesser || r.Phase != "settled" {
			return 403, "De rader sluit de beurt af."
		}
		if r.Turn+1 >= len(r.Players)*r.Turns {
			r.Phase = "finished"
		} else {
			r.Turn++
			r.Phase = "ready"
		}
		r.Question = nil
		r.Roles = nil
		r.Revealed = nil
		r.Kept = nil
	case "new-game":
		if !host || r.Phase != "finished" {
			return 403, "De host kan na afloop een nieuw spel openen."
		}
		r.Phase = "lobby"
		r.Turn = 0
		r.Question = nil
		r.Result = ""
		r.Gains = nil
		for i := range r.Players {
			r.Players[i].Score = 0
		}
	default:
		return 400, "Onbekende actie."
	}
	return 200, ""
}
func (s *Server) deal(r *Room, guesser string) (int, string) {
	used := map[string]bool{}
	for _, id := range r.Used {
		used[id] = true
	}
	available := []Question{}
	for _, q := range s.questions {
		if !used[q.ID] {
			available = append(available, q)
		}
	}
	if len(available) == 0 {
		return 409, "Alle vragen zijn gespeeld."
	}
	q := available[pick(len(available))]
	r.Question = &q
	r.Used = append(r.Used, q.ID)
	r.Roles = map[string]string{}
	r.Revealed = map[string]bool{}
	r.Kept = map[string]bool{}
	others := []string{}
	for _, p := range r.Players {
		if p.ID != guesser {
			others = append(others, p.ID)
			r.Roles[p.ID] = "red"
		}
	}
	r.Roles[others[pick(len(others))]] = "blue"
	r.Phase = "playing"
	r.Result = ""
	r.Gains = nil
	return 200, ""
}

// dropPlayer takes someone off the table at any moment. The turn order keeps
// its round and seat, an interrupted turn is dealt again, and a turn whose
// guesser left counts as played.
func dropPlayer(r *Room, id string) {
	n := len(r.Players)
	i := 0
	for i < n && r.Players[i].ID != id {
		i++
	}
	if i == n {
		return
	}
	round, seat := r.Turn/n, r.Turn%n
	r.Players = append(r.Players[:i:i], r.Players[i+1:]...)
	n--
	if n == 0 {
		return
	}
	if id == r.Host {
		r.Host = r.Players[0].ID
	}
	if r.Phase == "lobby" || r.Phase == "finished" {
		return
	}
	guesserLeft := i == seat
	if i < seat {
		seat--
	}
	r.Turn = round*n + seat
	broken := r.Phase == "playing" && (guesserLeft || r.Roles[id] == "blue")
	delete(r.Roles, id)
	delete(r.Revealed, id)
	delete(r.Kept, id)
	delete(r.Gains, id)
	if broken || (r.Phase == "settled" && guesserLeft) {
		r.Phase = "ready"
	}
	if n < 3 || r.Turn >= n*r.Turns {
		r.Phase = "finished"
	}
	if r.Phase != "playing" && r.Phase != "settled" {
		r.Question = nil
		r.Roles = nil
		r.Revealed = nil
		r.Kept = nil
	}
}
func redCount(r Room) int {
	n := 0
	for id, yes := range r.Revealed {
		if yes && r.Roles[id] == "red" {
			n++
		}
	}
	return n
}
func settle(r *Room, reason string) {
	r.Phase = "settled"
	r.Result = reason
	r.Gains = map[string]int{}
	g := r.Players[r.Turn%len(r.Players)].ID
	for i, p := range r.Players {
		n := 0
		if p.ID == g {
			if reason != "bust" {
				n = redCount(*r)
				if reason == "last-blue" {
					n++
				}
			}
		} else if r.Roles[p.ID] == "red" && !r.Revealed[p.ID] {
			n = 1
		} else if r.Roles[p.ID] == "blue" && reason == "bust" {
			n = 1
		}
		r.Gains[p.ID] = n
		r.Players[i].Score += n
	}
}

func pick(n int) int {
	v, e := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if e != nil {
		panic(e)
	}
	return int(v.Int64())
}
