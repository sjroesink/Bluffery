package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCatalogBoundsAndExactAttribution(t *testing.T) {
	s := setup(t)
	original := s.questions[0]
	cases := []func(*Question){func(q *Question) { q.Explanation = strings.Repeat("x", 1201) }, func(q *Question) {
		q.Sources[0].URL = "https://user:password@example.invalid/path"
		q.ID = "q_" + hash(q.Question + "\n" + q.Sources[0].URL)[:24]
	}, func(q *Question) { q.Answer = "\u202ebad" }, func(q *Question) { q.Sources[0].AccessedAt = "2999-01-01" }}
	for i, change := range cases {
		q := original
		q.Sources = append([]Source(nil), original.Sources...)
		change(&q)
		b, _ := json.Marshal(Catalog{SchemaVersion: 1, Questions: []Question{q}})
		if _, e := validateCatalog(b); e == nil {
			t.Fatal("unsafe catalog accepted", i)
		}
	}
}
func TestDatabaseHardQuota(t *testing.T) {
	s := setup(t)
	var n int
	if e := s.db.QueryRow(`PRAGMA max_page_count`).Scan(&n); e != nil || n != 65536 {
		t.Fatal("missing hard disk bound", n, e)
	}
}
