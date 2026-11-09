package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestScoringAllEdges(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		redReveals int
		end        string
		want       []int
	}{{"bank-zero", 0, "bank", []int{0, 0, 1, 1}}, {"bank-one", 1, "bank", []int{1, 0, 0, 1}}, {"bank-all-red", 2, "bank", []int{2, 0, 0, 0}}, {"blue-first", 0, "reveal", []int{0, 1, 1, 1}}, {"blue-after-red", 1, "reveal", []int{0, 1, 0, 1}}, {"blue-last", 2, "reveal", []int{3, 0, 0, 0}}} {
		t.Run(scenario.name, func(t *testing.T) {
			s := setup(t)
			cs, v := table(t, s)
			_, v = cmd(t, s, cs[0], v, "start", "")
			_, v = cmd(t, s, cs[0], v, "deal", "")
			actor := hash(strings.Split(strings.Split(cs[0], ";")[0], "=")[1])
			room, e := s.readRoom(actor)
			if e != nil {
				t.Fatal(e)
			}
			blue := ""
			reds := []string{}
			for _, p := range room.Players {
				if room.Roles[p.ID] == "blue" {
					blue = p.ID
				} else if room.Roles[p.ID] == "red" {
					reds = append(reds, p.ID)
				}
			}
			for i := 0; i < scenario.redReveals; i++ {
				status, x := cmd(t, s, cs[0], v, "reveal", publicID(reds[i]))
				if status != 200 {
					t.Fatal(status, x)
				}
				v = x
			}
			endTarget := ""
			if scenario.end == "reveal" {
				endTarget = publicID(blue)
			}
			status, v := cmd(t, s, cs[0], v, scenario.end, endTarget)
			if status != 200 {
				t.Fatal(status, v)
			}
			gains := v["gains"].(map[string]any)
			order := []string{actor, blue, reds[0], reds[1]}
			for i, id := range order {
				if gains[publicID(id)] != float64(scenario.want[i]) {
					t.Fatalf("%s got %v want %v", id, gains, scenario.want)
				}
			}
			if status, _ = cmd(t, s, cs[0], v, "bank", ""); status != 403 {
				t.Fatal("settled twice", status)
			}
		})
	}
}
func TestAuthorizationReplayStaleAndFinish(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, _, outsider := req(t, s, "", "/api/session", "")
	if st, _, _ := req(t, s, outsider, "/api/state", ""); st != 404 {
		t.Fatal(st)
	}
	if st, _, _ := req(t, s, "", "/api/state", ""); st != 404 {
		t.Fatal(st)
	}
	if st, _ := cmd(t, s, cs[1], v, "start", ""); st != 403 {
		t.Fatal(st)
	}
	v0 := v
	_, v = cmd(t, s, cs[0], v, "start", "")
	if st, _ := cmd(t, s, cs[0], v0, "deal", ""); st != 409 {
		t.Fatal(st)
	}
	for turn := 0; turn < 8; turn++ {
		g := turn % 4
		if st, _ := cmd(t, s, cs[(g+1)%4], v, "deal", ""); st != 403 {
			t.Fatal(st)
		}
		b, _ := json.Marshal(Command{ID: fmt.Sprintf("deal-%08d", turn), Action: "deal", Version: int(v["version"].(float64))})
		st, x, _ := req(t, s, cs[g], "/api/command", string(b))
		if st != 200 {
			t.Fatal(st, x)
		}
		v = x
		version := v["version"]
		st, x, _ = req(t, s, cs[g], "/api/command", string(b))
		if st != 200 || x["version"] != version {
			t.Fatal("replayed deal mutated", st, x)
		}
		changed := strings.Replace(string(b), `"deal"`, `"bank"`, 1)
		if st, _, _ = req(t, s, cs[g], "/api/command", changed); st != 409 {
			t.Fatal(st)
		}
		for i, c := range cs {
			_, p, _ := req(t, s, c, "/api/state", "")
			bytes, _ := json.Marshal(p)
			if i == g && (strings.Contains(string(bytes), "TESTANTWOORD") || p["sources"] != nil || p["role"] != nil || p["roles"] != nil) {
				t.Fatal("guesser leak", p)
			}
			if i != g && (p["answer"] == nil || p["roles"] != nil || p["sources"] != nil) {
				t.Fatal("member leak", p)
			}
		}
		if st, _ = cmd(t, s, cs[(g+1)%4], v, "bank", ""); st != 403 {
			t.Fatal(st)
		}
		_, v = cmd(t, s, cs[g], v, "bank", "")
		_, v = cmd(t, s, cs[g], v, "next", "")
	}
	if v["phase"] != "finished" {
		t.Fatal(v)
	}
	_, v = cmd(t, s, cs[0], v, "new-game", "")
	if v["phase"] != "lobby" {
		t.Fatal(v)
	}
}
func TestPersistenceAndPrivateFiles(t *testing.T) {
	dir := t.TempDir()
	s, e := openServer(dir, "http://localhost:8080", true)
	if e != nil {
		t.Fatal(e)
	}
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	for _, name := range []string{"bluffery.sqlite", "bluffery.sqlite-wal", "bluffery.sqlite-shm"} {
		info, e := os.Stat(filepath.Join(dir, name))
		if e != nil || info.Mode().Perm() != 0600 {
			t.Fatal(name, info, e)
		}
	}
	s.db.Close()
	s, e = openServer(dir, "http://localhost:8080", true)
	if e != nil {
		t.Fatal(e)
	}
	defer s.db.Close()
	_, after, _ := req(t, s, cs[0], "/api/state", "")
	if after["version"] != v["version"] || after["question"] != v["question"] {
		t.Fatal(after, v)
	}
	var raw string
	s.db.QueryRow(`SELECT hash FROM sessions LIMIT 1`).Scan(&raw)
	if strings.Contains(cs[0], raw) {
		t.Fatal("raw credential stored")
	}
}
func TestValidationOriginAndProxy(t *testing.T) {
	s := setup(t)
	_, _, c := req(t, s, "", "/api/session", "")
	for _, name := range []string{"", " a", "a\u202eb", strings.Repeat("a", 25), "a\nb"} {
		b, _ := json.Marshal(Command{ID: random(10), Action: "create", Name: name})
		if st, _, _ := req(t, s, c, "/api/command", string(b)); st != 400 {
			t.Fatal(name, st)
		}
	}
	for _, body := range []string{`{"id":"bad-id-000","action":"create","name":"A","extra":1}`, `{"id":"bad-id-000","action":"create","name":"A"} {}`, strings.Repeat("x", 3000)} {
		if st, _, _ := req(t, s, c, "/api/command", body); st != 400 {
			t.Fatal(st)
		}
	}
	r := httptest.NewRequest("POST", "/api/command", strings.NewReader(`{}`))
	r.Header.Set("Origin", "https://evil.invalid")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	r = httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:42"
	r.Header.Set("X-Forwarded-For", "203.0.113.7")
	if s.clientIP(r) != "192.0.2.1" {
		t.Fatal("forged proxy trusted")
	}
	_, n, _ := net.ParseCIDR("192.0.2.1/32")
	s.proxies = []*net.IPNet{n}
	if s.clientIP(r) != "203.0.113.7" {
		t.Fatal("trusted proxy ignored")
	}
}
func TestConcurrentDuplicateDeal(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	b, _ := json.Marshal(Command{ID: "concurrent-deal-01", Action: "deal", Version: int(v["version"].(float64))})
	var wg sync.WaitGroup
	versions := make(chan any, 2)
	for i := 0; i < 2; i++ {
		wg.Go(func() {
			st, x, _ := req(t, s, cs[0], "/api/command", string(b))
			if st != 200 {
				t.Error(st, x)
			}
			versions <- x["version"]
		})
	}
	wg.Wait()
	a, bv := <-versions, <-versions
	if a != bv {
		t.Fatal(a, bv)
	}
}
func TestRemovedPlayerCanRejoin(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, p, _ := req(t, s, cs[1], "/api/state", "")
	_, v = cmd(t, s, cs[0], v, "remove", p["me"].(string))
	if st, _, _ := req(t, s, cs[1], "/api/state", ""); st != 404 {
		t.Fatal(st)
	}
	b, _ := json.Marshal(Command{ID: "rejoin-000001", Action: "join", Name: "B", Code: v["code"].(string)})
	if st, x, _ := req(t, s, cs[1], "/api/command", string(b)); st != 200 {
		t.Fatal(st, x)
	}
}
