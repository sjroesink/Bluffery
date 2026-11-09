package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPersistentSessionLimitAndTenPhones(t *testing.T) {
	dir := t.TempDir()
	s, e := openServer(dir, "http://localhost:8080", true)
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 120; i++ {
		st, _, _ := req(t, s, "", "/api/session", "")
		if st != 200 {
			t.Fatal(i, st)
		}
	}
	if st, _, _ := req(t, s, "", "/api/session", ""); st != 429 {
		t.Fatal(st)
	}
	s.db.Close()
	s, e = openServer(dir, "http://localhost:8080", true)
	if e != nil {
		t.Fatal(e)
	}
	defer s.db.Close()
	if st, _, _ := req(t, s, "", "/api/session", ""); st != 429 {
		t.Fatal("limit lost on restart", st)
	}
	fresh := setup(t)
	cs, v := table(t, fresh)
	for i := 4; i < 10; i++ {
		_, _, c := req(t, fresh, "", "/api/session", "")
		b, _ := json.Marshal(Command{ID: fmt.Sprintf("join-%08d", i), Action: "join", Name: fmt.Sprint(i), Code: v["code"].(string)})
		st, x, _ := req(t, fresh, c, "/api/command", string(b))
		if st != 200 {
			t.Fatal(st, x)
		}
		v = x
		cs = append(cs, c)
	}
	_, _, extra := req(t, fresh, "", "/api/session", "")
	b, _ := json.Marshal(Command{ID: "overfull-join", Action: "join", Name: "Eleven", Code: v["code"].(string)})
	if st, _, _ := req(t, fresh, extra, "/api/command", string(b)); st != 409 {
		t.Fatal(st)
	}
	_, v = cmd(t, fresh, cs[0], v, "start", "")
	if v["turns"] != float64(1) {
		t.Fatal("wrong 10-player default", v)
	}
	_, v = cmd(t, fresh, cs[0], v, "deal", "")
	blue := 0
	for _, c := range cs[1:] {
		_, x, _ := req(t, fresh, c, "/api/state", "")
		if x["role"] == "blue" {
			blue++
		}
		if x["answer"] == nil {
			t.Fatal(x)
		}
	}
	if blue != 1 {
		t.Fatal(blue)
	}
}
func TestLateJoinAndNoPublicCatalog(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, _, c := req(t, s, "", "/api/session", "")
	b, _ := json.Marshal(Command{ID: "late-join-001", Action: "join", Name: "Late", Code: v["code"].(string)})
	if st, _, _ := req(t, s, c, "/api/command", string(b)); st != 409 {
		t.Fatal(st)
	}
	s.static = publicHandler()
	for _, path := range []string{"/api/questions", "/api/rooms", "/internal/catalog/questions.nl.json", "/api/state?code=" + v["code"].(string)} {
		st, x, _ := req(t, s, c, path, "")
		if st != 404 {
			t.Fatal(path, st, x)
		}
	}
	for _, p := range []string{"/", "/index.html", "/sw.js", "/manifest.webmanifest", "/icon-192.png", "/icon-maskable.png"} {
		r := httptest.NewRequest("GET", p, nil)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatal(p, w.Code)
		}
		if strings.Contains(w.Body.String(), "TESTANTWOORD") || strings.Contains(w.Body.String(), "TESTVRAAG") {
			t.Fatal("fixture leaked static", p)
		}
	}
}
func TestCatalogRejectsTrailingAndFuture(t *testing.T) {
	s := setup(t)
	c := Catalog{SchemaVersion: 1, Questions: s.questions[:1]}
	b, _ := json.Marshal(c)
	if _, e := validateCatalog(append(b, []byte(" {}")...)); e == nil {
		t.Fatal("accepted trailing JSON")
	}
	c.Questions[0].VerifiedAt = time.Now().AddDate(1, 0, 0).Format("2006-01-02")
	b, _ = json.Marshal(c)
	if _, e := validateCatalog(b); e == nil {
		t.Fatal("future verification accepted")
	}
}
func TestCommandLedgerQuota(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	actor := hash(strings.Split(strings.Split(cs[0], ";")[0], "=")[1])
	tx, _ := s.db.Begin()
	for i := 0; i < 5000; i++ {
		tx.Exec(`INSERT INTO commands VALUES(?,?,?,?,?)`, actor, fmt.Sprint(i), "{}", v["code"], time.Now().Unix())
	}
	tx.Commit()
	if st, _ := cmd(t, s, cs[0], v, "configure", ""); st != 429 {
		t.Fatal("unbounded command ledger", st)
	}
}
func TestExpiredRoomDoesNotReveal(t *testing.T) {
	s := setup(t)
	cs, _ := table(t, s)
	s.db.Exec(`UPDATE rooms SET expires=0`)
	if st, _, _ := req(t, s, cs[0], "/api/state", ""); st != 404 {
		t.Fatal(st)
	}
}
