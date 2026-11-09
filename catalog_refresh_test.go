package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func catalogRows(t *testing.T, s *Server) string {
	t.Helper()
	rows, err := s.db.Query(`SELECT id,data FROM catalog ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var all [][2]string
	for rows.Next() {
		var row [2]string
		if err := rows.Scan(&row[0], &row[1]); err != nil {
			t.Fatal(err)
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(all)
	return string(b)
}

func TestCatalogRefreshRejectsInvalidSeedWithoutMutation(t *testing.T) {
	s := setup(t)
	original := append([]Question(nil), s.questions...)
	before := catalogRows(t, s)
	cases := map[string][]Question{"empty": nil, "too-small": original[:19]}
	invalid := append([]Question(nil), original...)
	invalid[len(invalid)-1].Approved = false
	cases["unapproved-last"] = invalid
	duplicate := append([]Question(nil), original...)
	duplicate[len(duplicate)-1] = duplicate[0]
	cases["duplicate"] = duplicate
	for name, qs := range cases {
		t.Run(name, func(t *testing.T) {
			s.questions = qs
			if err := s.importCatalog(); err == nil {
				t.Fatal("invalid seed accepted")
			}
			if catalogRows(t, s) != before {
				t.Fatal("invalid seed mutated stored catalog")
			}
		})
	}
}

func TestCatalogRefreshCountsOnlyActiveUnusedQuestions(t *testing.T) {
	s := setup(t)
	cs, _ := table(t, s)
	var actor string
	if err := s.db.QueryRow(`SELECT hash FROM sessions WHERE room<>'' ORDER BY rowid LIMIT 1`).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	room, err := s.readRoom(actor)
	if err != nil {
		t.Fatal(err)
	}
	// Historical IDs retired by a refresh must not consume the new catalog's capacity.
	for _, q := range s.questions {
		room.Used = append(room.Used, q.ID)
	}
	s.questions = s.questions[:20]
	for i := range s.questions {
		s.questions[i].Question += " (vernieuwde testfixture)"
		s.questions[i].ID = "q_" + hash(s.questions[i].Question + "\n" + s.questions[i].Sources[0].URL)[:24]
	}
	if err := s.importCatalog(); err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = saveRoom(tx, room, false); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	_, v, _ := req(t, s, cs[0], "/api/state", "")
	if status, v := cmd(t, s, cs[0], v, "start", ""); status != 200 {
		t.Fatal("retired IDs falsely exhaust new catalog", status, v)
	}
	// Retained IDs still cannot repeat, including across a later new game.
	room.Phase = "ready"
	for _, q := range s.questions[:19] {
		room.Used = append(room.Used, q.ID)
	}
	beforeUsed := append([]string(nil), room.Used...)
	if status, _ := s.transition(&room, actor, Command{Action: "deal"}); status != 200 || room.Question.ID != s.questions[19].ID {
		t.Fatal("no-repeat lost", status, room.Question)
	}
	if len(room.Used) != len(beforeUsed)+1 {
		t.Fatal("historical used IDs discarded")
	}
	room.Phase = "ready"
	if status, _ := s.transition(&room, actor, Command{Action: "deal"}); status != 409 {
		t.Fatal("exhausted deck should reject deal")
	}
	room.Phase = "lobby"
	if status, _ := s.transition(&room, actor, Command{Action: "start"}); status != 409 {
		t.Fatal("exhausted deck should reject start")
	}
}

func TestCatalogRefreshPreservesRoundAndPrivateReconnect(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	_, v = cmd(t, s, cs[0], v, "bank", "") // Scores and a prior settled snapshot exist.
	_, v = cmd(t, s, cs[0], v, "next", "")
	_, v = cmd(t, s, cs[1], v, "deal", "")
	httpServer := httptest.NewServer(s)
	defer httpServer.Close()
	event := func() string {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		r, _ := http.NewRequestWithContext(ctx, "GET", httpServer.URL+"/api/events", nil)
		r.Header.Set("Cookie", cs[1])
		r.Header.Set("Last-Event-ID", fmt.Sprint(v["version"]))
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		return readEvent(t, bufio.NewReader(res.Body))
	}
	beforeEvent := event()
	var beforeRoom string
	if err := s.db.QueryRow(`SELECT data FROM rooms WHERE code=?`, v["code"]).Scan(&beforeRoom); err != nil {
		t.Fatal(err)
	}
	before := make([]map[string]any, len(cs))
	for i, c := range cs {
		_, before[i], _ = req(t, s, c, "/api/state", "")
	}
	var ledgerBefore int
	if err := s.db.QueryRow(`SELECT count(*) FROM commands`).Scan(&ledgerBefore); err != nil {
		t.Fatal(err)
	}
	var room Room
	if err := json.Unmarshal([]byte(beforeRoom), &room); err != nil {
		t.Fatal(err)
	}
	kept := []Question{}
	for _, q := range s.questions {
		if q.ID != room.Question.ID {
			kept = append(kept, q)
		}
	}
	s.questions = kept[:20]
	if err := s.importCatalog(); err != nil {
		t.Fatal(err)
	}
	if event() != beforeEvent {
		t.Fatal("SSE resume revision changed")
	}
	for i, c := range cs {
		_, after, _ := req(t, s, c, "/api/state", "")
		if !reflect.DeepEqual(after, before[i]) {
			t.Fatal("private resume projection changed", i)
		}
	}
	var afterRoom string
	s.db.QueryRow(`SELECT data FROM rooms WHERE code=?`, v["code"]).Scan(&afterRoom)
	if afterRoom != beforeRoom {
		t.Fatal("round snapshot/scores/history mutated")
	}
	var ledgerAfter int
	s.db.QueryRow(`SELECT count(*) FROM commands`).Scan(&ledgerAfter)
	if ledgerAfter != ledgerBefore {
		t.Fatal("ledger changed")
	}
	// Replaying an actual pre-refresh command remains idempotent.
	var actor, id, payload string
	if err := s.db.QueryRow(`SELECT actor,id,payload FROM commands ORDER BY rowid DESC LIMIT 1`).Scan(&actor, &id, &payload); err != nil {
		t.Fatal(err)
	}
	var c Command
	json.Unmarshal([]byte(payload), &c)
	if status, _ := s.command(actor, c); status != 200 {
		t.Fatal("ledger replay failed", status, id)
	}
	_, v = cmd(t, s, cs[1], v, "bank", "")
	sources := v["sources"].([]any)
	if v["answer"] != room.Question.Answer || sources[0].(map[string]any)["rightsNote"] != room.Question.Sources[0].RightsNote {
		t.Fatal("retired snapshot lost at settlement")
	}
}

func TestCatalogRefreshFailureRollsBackUpsertsAndRetirement(t *testing.T) {
	s := setup(t)
	before := catalogRows(t, s)
	s.questions = append([]Question(nil), s.questions[:20]...)
	s.questions[0].Answer = "CHANGED TESTFIXTURE"
	if _, err := s.db.Exec(`CREATE TRIGGER reject_retirement BEFORE DELETE ON catalog WHEN (SELECT count(*) FROM catalog)=21 BEGIN SELECT RAISE(ABORT,'test retirement failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.importCatalog(); err == nil {
		t.Fatal("expected SQLite failure")
	}
	if catalogRows(t, s) != before {
		t.Fatal("partial catalog committed")
	}
}

func TestCatalogRefreshRetiresOnlyMissingIDs(t *testing.T) {
	s := setup(t)
	retired := append([]Question(nil), s.questions[20:]...)
	s.questions = s.questions[:20]
	if err := s.importCatalog(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM catalog`).Scan(&n); err != nil || n != 20 {
		t.Fatalf("authoritative catalog: count=%d err=%v", n, err)
	}
	for _, q := range retired {
		if err := s.db.QueryRow(`SELECT count(*) FROM catalog WHERE id=?`, q.ID).Scan(&n); err != nil || n != 0 {
			t.Fatal("retired ID remains", q.ID, n, err)
		}
	}
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	for _, q := range retired {
		if v["question"] == q.Question {
			t.Fatal("retired question dealt")
		}
	}
	before := catalogRows(t, s)
	if err := s.importCatalog(); err != nil {
		t.Fatal(err)
	}
	if catalogRows(t, s) != before {
		t.Fatal("non-idempotent import")
	}
}
