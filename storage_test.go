package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestExpiredActorRecheckedInsideTransaction(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	actor := hash(strings.Split(strings.Split(cs[0], ";")[0], "=")[1])
	s.db.Exec(`UPDATE sessions SET expires=0 WHERE hash=?`, actor)
	st, _ := s.command(actor, Command{ID: "late-body-command", Action: "configure", Turns: 1, Version: int(v["version"].(float64))})
	if st != 404 {
		t.Fatal("expired actor allowed", st)
	}
}
func TestNewRoomCollisionCannotOverwrite(t *testing.T) {
	s := setup(t)
	_, v := table(t, s)
	code := v["code"].(string)
	tx, e := s.db.Begin()
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback()
	if e = saveRoom(tx, Room{Code: code, Phase: "lobby", Players: []Player{{ID: strings.Repeat("a", 64), Name: "Attacker"}}}, true); e == nil {
		t.Fatal("existing code overwritten")
	}
	var data string
	tx.QueryRow(`SELECT data FROM rooms WHERE code=?`, code).Scan(&data)
	var room Room
	json.Unmarshal([]byte(data), &room)
	if room.Players[0].Name != "A" {
		t.Fatal(data)
	}
}
func TestProductionImportIdempotentAndApprovedOnly(t *testing.T) {
	s := setup(t)
	if e := s.importCatalog(); e != nil {
		t.Fatal(e)
	}
	var n int
	s.db.QueryRow(`SELECT count(*) FROM catalog`).Scan(&n)
	if n != len(s.questions) {
		t.Fatal(n)
	}
	c := Catalog{SchemaVersion: 1, Questions: s.questions[:1]}
	c.Questions[0].Approved = false
	b, _ := json.Marshal(c)
	if _, e := validateCatalog(b); e == nil {
		t.Fatal("unreviewed content accepted")
	}
}
