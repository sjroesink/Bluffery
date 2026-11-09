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
