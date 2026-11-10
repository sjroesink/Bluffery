package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Tekst voor de tv-presentator en de personages; de uitspraken maakt scripts/speak.mjs --set host.
//
//go:embed internal/catalog/host.nl.json
var hostJSON []byte

type Character struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Accessory string `json:"accessory"`
}
type HostLine struct {
	ID     string `json:"id"`
	Moment string `json:"moment"`
	Text   string `json:"text"`
}
type HostScript struct {
	Characters []Character `json:"characters"`
	Lines      []HostLine  `json:"lines"`
}

var hostIDRE = regexp.MustCompile(`^[a-z0-9.-]{1,64}$`)
var colorRE = regexp.MustCompile(`^#[0-9a-f]{6}$`)
var accessories = map[string]bool{"tophat": true, "glasses": true, "moustache": true, "bow": true, "monocle": true, "crown": true, "cap": true, "halo": true}

func loadHost() (HostScript, error) {
	var h HostScript
	d := json.NewDecoder(strings.NewReader(string(hostJSON)))
	d.DisallowUnknownFields()
	if e := d.Decode(&h); e != nil {
		return h, e
	}
	if d.Decode(new(any)) != io.EOF {
		return h, fmt.Errorf("host: trailing JSON")
	}
	// Elke speler aan een volle tafel moet een eigen personage kunnen krijgen.
	if len(h.Characters) < 10 {
		return h, fmt.Errorf("host: at least 10 characters required")
	}
	seen := map[string]bool{}
	for _, c := range h.Characters {
		id := "char." + c.ID
		if !hostIDRE.MatchString(id) || seen[id] || !validText(c.Name, 24) || !colorRE.MatchString(c.Color) || !accessories[c.Accessory] {
			return h, fmt.Errorf("host: invalid character %q", c.ID)
		}
		seen[id] = true
	}
	for _, l := range h.Lines {
		if !hostIDRE.MatchString(l.ID) || seen[l.ID] || !validText(l.Moment, 32) || !validText(l.Text, 300) {
			return h, fmt.Errorf("host: invalid line %q", l.ID)
		}
		seen[l.ID] = true
	}
	return h, nil
}
func (s *Server) character(id string) bool {
	for _, c := range s.characters {
		if c.ID == id {
			return true
		}
	}
	return false
}

// freeCharacter kiest willekeurig een personage dat nog niemand aan tafel heeft.
func (s *Server) freeCharacter(r Room) string {
	taken := map[string]bool{}
	for _, p := range r.Players {
		taken[p.Character] = true
	}
	free := []string{}
	for _, c := range s.characters {
		if !taken[c.ID] {
			free = append(free, c.ID)
		}
	}
	if len(free) == 0 {
		return ""
	}
	return free[pick(len(free))]
}

// sameAnswer vergelijkt zonder hoofdletters, spaties en leestekens.
func sameAnswer(a, b string) bool {
	norm := func(s string) string {
		var out strings.Builder
		for _, r := range strings.ToLower(s) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				out.WriteRune(r)
			}
		}
		return out.String()
	}
	return norm(a) != "" && norm(a) == norm(b)
}
func validText(s string, max int) bool {
	if s != strings.TrimSpace(s) || s == "" || utf8.RuneCountInString(s) > max {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return false
		}
	}
	return true
}
