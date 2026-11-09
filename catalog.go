package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode"
)

//go:embed internal/catalog/questions.nl.json
var catalogFS embed.FS

type Source struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	Publisher  string `json:"publisher"`
	AccessedAt string `json:"accessedAt"`
	RightsNote string `json:"rightsNote"`
}
type Question struct {
	ID          string   `json:"id"`
	Question    string   `json:"question"`
	Answer      string   `json:"answer"`
	Aliases     []string `json:"aliases"`
	Category    string   `json:"category"`
	Explanation string   `json:"explanation"`
	Sources     []Source `json:"sources"`
	VerifiedAt  string   `json:"verifiedAt"`
	Approved    bool     `json:"approved"`
}
type Catalog struct {
	SchemaVersion int        `json:"schemaVersion"`
	Questions     []Question `json:"questions"`
}

func validateCatalog(b []byte) ([]Question, error) {
	var c Catalog
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.DisallowUnknownFields()
	if e := d.Decode(&c); e != nil {
		return nil, e
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, fmt.Errorf("trailing JSON")
	}
	if len(b) > 8<<20 || len(c.Questions) > 2000 {
		return nil, fmt.Errorf("catalog too large")
	}
	if c.SchemaVersion != 1 {
		return nil, fmt.Errorf("schemaVersion must be 1")
	}
	seen := map[string]bool{}
	texts := map[string]bool{}
	for i, q := range c.Questions {
		bad := func(s string) ([]Question, error) { return nil, fmt.Errorf("question %d: %s", i, s) }
		if len(q.Sources) == 0 || len(q.Sources) > 8 {
			return bad("source required")
		}
		want := "q_" + hash(q.Question + "\n" + q.Sources[0].URL)[:24]
		if q.ID != want || seen[q.ID] || texts[strings.ToLower(q.Question)] {
			return bad("invalid ID or duplicate")
		}
		seen[q.ID] = true
		texts[strings.ToLower(q.Question)] = true
		if !q.Approved || len(q.Question) < 8 || len(q.Question) > 400 || len(q.Answer) < 1 || len(q.Answer) > 200 || q.Category == "" || q.Explanation == "" || len(q.Explanation) > 1200 || len(q.Category) > 80 || len(q.Aliases) > 20 {
			return bad("unapproved or invalid fields")
		}
		if date, e := time.Parse("2006-01-02", q.VerifiedAt); e != nil || date.After(time.Now().UTC()) {
			return bad("invalid verified date")
		}
		for _, s := range q.Sources {
			u, e := url.Parse(s.URL)
			if e != nil || u.Hostname() == "" || u.Scheme != "https" || u.User != nil || len(s.URL) > 2000 || len(s.Title) > 300 || len(s.Publisher) > 120 || len(s.RightsNote) > 500 {
				return bad("invalid source URL or attribution bounds")
			}
			if s.Title == "" || s.Publisher == "" || s.RightsNote == "" {
				return bad("invalid attribution")
			}
			if date, e := time.Parse("2006-01-02", s.AccessedAt); e != nil || date.After(time.Now().UTC()) {
				return bad("invalid access date")
			}
		}
		fields := []string{q.Question, q.Answer, q.Category, q.Explanation}
		fields = append(fields, q.Aliases...)
		for _, source := range q.Sources {
			fields = append(fields, source.URL, source.Title, source.Publisher, source.RightsNote)
		}
		for _, field := range fields {
			if strings.TrimSpace(field) != field || field == "" {
				return bad("empty or padded text")
			}
			for _, r := range field {
				if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
					return bad("control or invisible formatting in text")
				}
			}
		}
		for _, alias := range q.Aliases {
			if len(alias) > 200 {
				return bad("alias too long")
			}
		}
		encoded, _ := json.Marshal(q)
		if len(encoded) > 8192 {
			return bad("question exceeds 8KiB storage bound")
		}
	}
	return c.Questions, nil
}
func loadCatalog(fixtures bool) ([]Question, error) {
	b, e := catalogFS.ReadFile("internal/catalog/questions.nl.json")
	if e != nil {
		return nil, e
	}
	qs, e := validateCatalog(b)
	if e != nil {
		return nil, e
	}
	if fixtures {
		qs = nil
		for i := 0; i < 30; i++ {
			q := Question{Question: fmt.Sprintf("TESTVRAAG %d: welk testwoord staat op de kaart?", i), Answer: fmt.Sprintf("TESTANTWOORD-%d", i), Category: "Ontwikkelfixture", Explanation: "Dit is nadrukkelijk geen feitelijke vraag.", Sources: []Source{{URL: "https://example.invalid/fixture", Title: "LOKALE TESTFIXTURE", Publisher: "Geen bron", AccessedAt: "2026-11-07", RightsNote: "Eigen testtekst, niet voor productie."}}, VerifiedAt: "2026-11-07", Approved: true}
			q.ID = "q_" + hash(q.Question + "\n" + q.Sources[0].URL)[:24]
			qs = append(qs, q)
		}
	}
	if len(qs) == 0 {
		return nil, fmt.Errorf("approved catalog empty: import vetted content before production; BLUFFERY_DEV_FIXTURES=1 is local test only")
	}
	return qs, nil
}
func catalogCommand(path string) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	qs, e := validateCatalog(b)
	if e != nil {
		return e
	}
	fmt.Printf("Validated %d approved questions\n", len(qs))
	return nil
}
