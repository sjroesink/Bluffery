package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestApprovedProductionSeedAndNormalGame(t *testing.T) {
	s, e := openServer(t.TempDir(), "http://localhost:8080", false)
	if e != nil {
		t.Fatal(e)
	}
	defer s.db.Close()
	if len(s.questions) < 20 {
		t.Fatal("not enough approved questions for maximal configured game")
	}
	publishers := map[string]bool{}
	for _, q := range s.questions {
		if !q.Approved || strings.Contains(q.Question, "TESTVRAAG") || strings.Contains(q.Answer, "TESTANTWOORD") {
			t.Fatal("fixture/unreviewed card in normal mode")
		}
		for _, src := range q.Sources {
			u, _ := url.Parse(src.URL)
			publishers[u.Hostname()] = true
		}
	}
	if len(publishers) < 3 {
		t.Fatal("insufficient source diversity")
	}
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	if v["answer"] != nil || v["sources"] != nil || strings.Contains(v["question"].(string), "TESTVRAAG") {
		t.Fatal("normal guesser privacy", v)
	}
	_, v = cmd(t, s, cs[0], v, "bank", "")
	if v["answer"] == nil || len(v["sources"].([]any)) == 0 {
		t.Fatal("normal settlement missing provenance", v)
	}
	var n int
	s.db.QueryRow(`SELECT count(*) FROM catalog`).Scan(&n)
	if n != len(s.questions) {
		t.Fatal("production seed import count", n, len(s.questions))
	}
}
