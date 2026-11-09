package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func req(t *testing.T, s *Server, cookie, path, body string) (int, map[string]any, string) {
	t.Helper()
	m := "GET"
	if body != "" {
		m = "POST"
	}
	r := httptest.NewRequest(m, path, strings.NewReader(body))
	r.Header.Set("Origin", s.origin)
	r.Header.Set("Content-Type", "application/json")
	if cookie != "" {
		r.Header.Set("Cookie", cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	b, _ := io.ReadAll(w.Result().Body)
	v := map[string]any{}
	json.Unmarshal(b, &v)
	return w.Code, v, w.Header().Get("Set-Cookie")
}
func setup(t *testing.T) *Server {
	t.Helper()
	s, e := openServer(t.TempDir(), "http://localhost:8080", true)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.db.Close() })
	return s
}
func table(t *testing.T, s *Server) ([]string, map[string]any) {
	t.Helper()
	cookies := []string{}
	var v map[string]any
	code := ""
	for i := 0; i < 4; i++ {
		_, _, c := req(t, s, "", "/api/session", "")
		cookies = append(cookies, c)
		action := "join"
		if i == 0 {
			action = "create"
		}
		body, _ := json.Marshal(Command{ID: "initial-0001", Action: action, Name: []string{"A", "B", "C", "D"}[i], Code: code})
		status, x, _ := req(t, s, c, "/api/command", string(body))
		if status != 200 {
			t.Fatal(status, x)
		}
		v = x
		code = v["code"].(string)
	}
	return cookies, v
}
func cmd(t *testing.T, s *Server, c string, v map[string]any, action, target string) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(Command{ID: random(12), Action: action, Target: target, Version: int(v["version"].(float64))})
	status, x, _ := req(t, s, c, "/api/command", string(b))
	return status, x
}
func TestDealPrivacyAndBank(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	status, v := cmd(t, s, cs[0], v, "start", "")
	if status != 200 {
		t.Fatal(status, v)
	}
	status, v = cmd(t, s, cs[0], v, "deal", "")
	if status != 200 {
		t.Fatal(status, v)
	}
	if v["answer"] != nil || v["role"] != nil || v["sources"] != nil {
		t.Fatal("host guesser leak", v)
	}
	blue, red := 0, 0
	target := ""
	for i := 1; i < 4; i++ {
		_, p, _ := req(t, s, cs[i], "/api/state", "")
		if p["answer"] == nil {
			t.Fatal("missing answer")
		}
		if p["role"] == "blue" {
			blue++
		} else if p["role"] == "red" {
			red++
			target = p["me"].(string)
		} else {
			t.Fatal(p)
		}
	}
	if blue != 1 || red != 2 {
		t.Fatal(blue, red)
	}
	status, v = cmd(t, s, cs[0], v, "keep", target)
	if status != 200 || v["phase"] != "playing" {
		t.Fatal(status, v)
	}
	status, v = cmd(t, s, cs[0], v, "reveal", target)
	if status != 200 || v["provisional"] != float64(1) {
		t.Fatal(status, v)
	}
	status, v = cmd(t, s, cs[0], v, "bank", "")
	if status != 200 || v["phase"] != "settled" || v["answer"] == nil {
		t.Fatal(status, v)
	}
	ps := v["players"].([]any)
	if ps[0].(map[string]any)["score"] != float64(1) {
		t.Fatal(v)
	}
}
func TestCreateResume(t *testing.T) {
	s := setup(t)
	_, _, c := req(t, s, "", "/api/session", "")
	if !strings.Contains(c, "HttpOnly") {
		t.Fatal(c)
	}
	status, v, _ := req(t, s, c, "/api/command", `{"id":"create-0001","action":"create","name":"Sander"}`)
	if status != http.StatusOK {
		t.Fatal(status, v)
	}
	_, v, _ = req(t, s, c, "/api/state", "")
	if v["phase"] != "lobby" {
		t.Fatal(v)
	}
	if v["answer"] != nil {
		t.Fatal("answer leaked")
	}
}
func TestConfigureTurnsRange(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	for _, c := range []struct{ turns, status int }{{0, 400}, {6, 400}, {3, 200}, {maxTurns, 200}, {1, 200}} {
		b, _ := json.Marshal(Command{ID: random(12), Action: "configure", Turns: c.turns, Version: int(v["version"].(float64))})
		st, x, _ := req(t, s, cs[0], "/api/command", string(b))
		if st != c.status {
			t.Fatal(c.turns, st, x)
		}
		if st == 200 {
			if x["turns"] != float64(c.turns) {
				t.Fatal("turns not stored", c.turns, x)
			}
			v = x
		}
	}
}
func TestSkipQuestion(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	allow := func(c string, on bool) (int, map[string]any) {
		b, _ := json.Marshal(Command{ID: random(12), Action: "allow-skips", Skips: on, Version: int(v["version"].(float64))})
		st, x, _ := req(t, s, c, "/api/command", string(b))
		return st, x
	}
	if st, x := allow(cs[0], true); st != 200 || x["skips"] != true {
		t.Fatal(st, x)
	} else {
		v = x
	}
	_, v = cmd(t, s, cs[0], v, "start", "")
	status, v := cmd(t, s, cs[0], v, "deal", "")
	if status != 200 {
		t.Fatal(status, v)
	}
	if st, x := allow(cs[0], false); st != 200 || x["skips"] != false {
		t.Fatal(st, x)
	} else {
		v = x
	}
	if st, _ := cmd(t, s, cs[0], v, "skip", ""); st != 403 {
		t.Fatal("skip while off", st)
	}
	if st, _ := allow(cs[1], true); st != 403 {
		t.Fatal("non-host toggle", st)
	}
	_, v = allow(cs[0], true)
	if st, _ := cmd(t, s, cs[1], v, "skip", ""); st != 403 {
		t.Fatal("non-guesser skip", st)
	}
	_, other, _ := req(t, s, cs[1], "/api/state", "")
	_, v = cmd(t, s, cs[0], v, "keep", other["me"].(string))
	before := v["question"]
	status, v = cmd(t, s, cs[0], v, "skip", "")
	if status != 200 || v["phase"] != "playing" || v["question"] == before || v["turn"] != float64(0) || len(v["kept"].(map[string]any)) != 0 {
		t.Fatal(status, v)
	}
	_, v = cmd(t, s, cs[0], v, "reveal", other["me"].(string))
	if v["phase"] == "playing" {
		if st, _ := cmd(t, s, cs[0], v, "skip", ""); st != 409 {
			t.Fatal("skip after reveal", st)
		}
	}
}
func TestLeaveAndRemoveMidGame(t *testing.T) {
	s := setup(t)
	_, _, extra := req(t, s, "", "/api/session", "")
	cs, v := table(t, s)
	b, _ := json.Marshal(Command{ID: "initial-0001", Action: "join", Name: "E", Code: v["code"].(string)})
	_, v, _ = req(t, s, extra, "/api/command", string(b))
	cs = append(cs, extra)
	me := func(c string) string { _, p, _ := req(t, s, c, "/api/state", ""); return p["me"].(string) }
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	if v["guesser"] != me(cs[0]) || v["totalTurns"] != float64(10) {
		t.Fatal(v)
	}
	// A non-host cannot remove anyone, and the host cannot remove itself.
	if st, _ := cmd(t, s, cs[1], v, "remove", me(cs[2])); st != 403 {
		t.Fatal("non-host remove", st)
	}
	if st, _ := cmd(t, s, cs[0], v, "remove", me(cs[0])); st != 400 {
		t.Fatal("host self-remove", st)
	}
	// Removing the guesser mid-turn hands the same turn slot to the next player, undealt.
	guest := me(cs[1])
	b, _ = json.Marshal(Command{ID: random(12), Action: "leave", Version: int(v["version"].(float64))})
	st, x, _ := req(t, s, cs[0], "/api/command", string(b))
	if st != 200 || x["left"] != true {
		t.Fatal(st, x)
	}
	if st, _, _ := req(t, s, cs[0], "/api/state", ""); st != 404 {
		t.Fatal("leaver still seated", st)
	}
	_, v, _ = req(t, s, cs[1], "/api/state", "")
	if v["host"] != guest || v["guesser"] != guest || v["phase"] != "ready" || v["turn"] != float64(0) || v["totalTurns"] != float64(8) || len(v["players"].([]any)) != 4 {
		t.Fatal("after host left", v)
	}
	// The new host removes someone during a turn; the turn continues with fewer players.
	_, v = cmd(t, s, cs[1], v, "deal", "")
	_, v = cmd(t, s, cs[1], v, "remove", me(cs[4]))
	if v["guesser"] != guest || len(v["players"].([]any)) != 3 {
		t.Fatal("after remove", v)
	}
	if st, _, _ := req(t, s, cs[4], "/api/state", ""); st != 404 {
		t.Fatal("removed still seated", st)
	}
	// Below three players the game ends.
	_, v = cmd(t, s, cs[1], v, "remove", me(cs[3]))
	if v["phase"] != "finished" {
		t.Fatal("not finished", v)
	}
	// The last two leave and the room disappears.
	for _, c := range []string{cs[2], cs[1]} {
		_, v, _ = req(t, s, c, "/api/state", "")
		b, _ = json.Marshal(Command{ID: random(12), Action: "leave", Version: int(v["version"].(float64))})
		if st, x, _ := req(t, s, c, "/api/command", string(b)); st != 200 {
			t.Fatal(st, x)
		}
	}
	var n int
	s.db.QueryRow(`SELECT count(*) FROM rooms`).Scan(&n)
	if n != 0 {
		t.Fatal("empty room kept", n)
	}
}
func TestMakeHost(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	me := func(c string) string { _, p, _ := req(t, s, c, "/api/state", ""); return p["me"].(string) }
	if st, _ := cmd(t, s, cs[1], v, "make-host", me(cs[2])); st != 403 {
		t.Fatal("non-host transfer", st)
	}
	if st, _ := cmd(t, s, cs[0], v, "make-host", "nobody"); st != 400 {
		t.Fatal("unknown target", st)
	}
	st, v := cmd(t, s, cs[0], v, "make-host", me(cs[2]))
	if st != 200 || v["host"] != me(cs[2]) {
		t.Fatal(st, v)
	}
	// The old host is an ordinary player now, and the new one can remove them.
	if st, _ := cmd(t, s, cs[0], v, "start", ""); st != 403 {
		t.Fatal("old host still in charge", st)
	}
	if st, x := cmd(t, s, cs[2], v, "remove", me(cs[0])); st != 200 || len(x["players"].([]any)) != 3 {
		t.Fatal(st, x)
	}
}
