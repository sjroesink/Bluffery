package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func send(t *testing.T, s *Server, cookie string, c Command) (int, map[string]any) {
	t.Helper()
	if c.ID == "" {
		c.ID = random(12)
	}
	b, _ := json.Marshal(c)
	status, v, _ := req(t, s, cookie, "/api/command", string(b))
	return status, v
}
func version(v map[string]any) int { return int(v["version"].(float64)) }

func TestTvMode(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	code := v["code"].(string)
	chars := map[string]bool{}
	for _, p := range v["players"].([]any) {
		c := p.(map[string]any)["character"].(string)
		if c == "" || chars[c] {
			t.Fatal("character not unique", v["players"])
		}
		chars[c] = true
	}

	if status, x := send(t, s, cs[1], Command{Action: "tv", TV: true, Version: version(v)}); status != 403 {
		t.Fatal("non-host tv", status, x)
	}
	var screens []string
	for i := 0; i < 3; i++ {
		_, _, c := req(t, s, "", "/api/session", "")
		screens = append(screens, c)
	}
	if status, _ := send(t, s, screens[0], Command{Action: "watch", Code: "nope"}); status != 400 {
		t.Fatal("bad code", status)
	}
	status, x := send(t, s, screens[0], Command{Action: "watch", Code: code})
	if status != 200 || x["screen"] != true || x["tv"] != true {
		t.Fatal("watch", status, x)
	}
	send(t, s, screens[1], Command{Action: "watch", Code: code})
	if status, _ := send(t, s, screens[2], Command{Action: "watch", Code: code}); status != 409 {
		t.Fatal("third screen", status)
	}
	_, v, _ = req(t, s, cs[0], "/api/state", "")
	if v["screens"].(float64) != 2 || len(v["players"].([]any)) != 4 {
		t.Fatal("screens counted as players", v)
	}
	if status, _ := send(t, s, screens[0], Command{Action: "start", Version: version(v)}); status != 403 {
		t.Fatal("screen may only watch", status)
	}

	// Personage kiezen: bezet geeft 409, vrij lukt.
	taken := v["players"].([]any)[0].(map[string]any)["character"].(string)
	if status, _ := send(t, s, cs[1], Command{Action: "character", Character: taken, Version: version(v)}); status != 409 {
		t.Fatal("taken character", status)
	}
	free := ""
	for _, c := range s.characters {
		if !chars[c.ID] {
			free = c.ID
		}
	}
	status, v = send(t, s, cs[1], Command{Action: "character", Character: free, Version: version(v)})
	if status != 200 || v["players"].([]any)[1].(map[string]any)["character"] != free {
		t.Fatal("character", status, v)
	}

	_, v = cmd(t, s, cs[0], v, "start", "")
	status, v = cmd(t, s, cs[0], v, "deal", "")
	if status != 200 {
		t.Fatal(status, v)
	}
	_, tv, _ := req(t, s, screens[0], "/api/state", "")
	if tv["answer"] != nil || tv["role"] != nil || tv["answers"] != nil || tv["question"] == nil {
		t.Fatal("screen leak", tv)
	}
	if status, _ := send(t, s, cs[0], Command{Action: "answer", Text: "iets", Version: version(v)}); status != 403 {
		t.Fatal("guesser answers", status)
	}
	if status, _ := cmd(t, s, cs[0], v, "reveal", publicID(strings.Repeat("0", 64))); status != 409 {
		t.Fatal("reveal before answers", status)
	}

	var red, blue string
	for i, c := range cs[1:] {
		_, me, _ := req(t, s, c, "/api/state", "")
		if me["role"] == "blue" {
			blue = cs[i+1]
		}
		if me["role"] == "red" && red == "" {
			if status, _ := send(t, s, c, Command{Action: "answer", Text: " " + me["answer"].(string) + "!", Version: version(me)}); status != 400 {
				t.Fatal("padded answer", status)
			}
			if status, _ := send(t, s, c, Command{Action: "answer", Text: strings.ToUpper(me["answer"].(string)), Version: version(me)}); status != 409 {
				t.Fatal("red typed the truth", status)
			}
			red = c
		}
	}
	_ = red
	for _, c := range cs[1:] {
		_, me, _ := req(t, s, c, "/api/state", "")
		text := "Verzonnen door " + me["me"].(string)[:4]
		if c == blue {
			text = me["answer"].(string)
		}
		if status, x := send(t, s, c, Command{Action: "answer", Text: text, Version: version(me)}); status != 200 {
			t.Fatal("answer", status, x)
		}
		_, tv, _ = req(t, s, screens[0], "/api/state", "")
		if c != cs[3] && tv["answers"] != nil {
			t.Fatal("answers before all in", tv)
		}
	}
	if len(tv["answers"].(map[string]any)) != 3 || len(tv["submitted"].([]any)) != 3 || tv["answer"] != nil {
		t.Fatal("all in", tv)
	}
	_, me, _ := req(t, s, cs[1], "/api/state", "")
	if status, _ := send(t, s, cs[1], Command{Action: "answer", Text: "te laat", Version: version(me)}); status != 409 {
		t.Fatal("answer after all in", status)
	}

	_, v, _ = req(t, s, cs[0], "/api/state", "")
	_, blueState, _ := req(t, s, blue, "/api/state", "")
	status, v = cmd(t, s, cs[0], v, "reveal", blueState["me"].(string))
	if status != 200 || v["phase"] != "settled" || v["answers"] == nil {
		t.Fatal("reveal", status, v)
	}
	_, tv, _ = req(t, s, screens[0], "/api/state", "")
	if tv["answer"] == nil || tv["roles"] == nil {
		t.Fatal("settled screen", tv)
	}
	_, v = cmd(t, s, cs[0], v, "next", "")
	if v["submitted"] != nil {
		t.Fatal("answers survive next", v)
	}

	// Een scherm kan weer weg, en een speler die vertrekt neemt zijn antwoord mee.
	status, x = send(t, s, screens[1], Command{Action: "unwatch"})
	if status != 200 || x["left"] != true {
		t.Fatal("unwatch", status, x)
	}
	if status, _, _ := req(t, s, screens[1], "/api/state", ""); status != 404 {
		t.Fatal("unwatched screen still sees state", status)
	}
}

func TestTvAnswerLeaves(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, v = send(t, s, cs[0], Command{Action: "tv", TV: true, Version: version(v)})
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	var reds []string
	for _, c := range cs[1:] {
		_, me, _ := req(t, s, c, "/api/state", "")
		if me["role"] == "red" {
			reds = append(reds, c)
		}
	}
	_, me, _ := req(t, s, reds[0], "/api/state", "")
	send(t, s, reds[0], Command{Action: "answer", Text: "Een smoes", Version: version(me)})
	_, me, _ = req(t, s, reds[1], "/api/state", "")
	send(t, s, reds[1], Command{Action: "answer", Text: "Nog een smoes", Version: version(me)})
	_, me, _ = req(t, s, reds[0], "/api/state", "")
	if len(me["submitted"].([]any)) != 2 {
		t.Fatal("submitted", me)
	}
	status, me := send(t, s, reds[0], Command{Action: "leave", Version: version(me)})
	if status != 200 {
		t.Fatal(status, me)
	}
	_, v, _ = req(t, s, cs[0], "/api/state", "")
	if len(v["submitted"].([]any)) != 1 || v["phase"] != "playing" {
		t.Fatal("leaver's answer kept", v)
	}
}

func TestStaleSeatAllowsWatch(t *testing.T) {
	s := setup(t)
	_, _, c := req(t, s, "", "/api/session", "")
	_, _, tv := req(t, s, "", "/api/session", "")
	status, v := send(t, s, c, Command{Action: "create", Name: "Solo"})
	if status != 200 {
		t.Fatal(status, v)
	}
	_, v = send(t, s, tv, Command{Action: "watch", Code: v["code"].(string)})
	if status, x := send(t, s, c, Command{Action: "leave", Version: version(v)}); status != 200 {
		t.Fatal(status, x)
	}
	// De tafel is opgeheven; het scherm mag aan een nieuwe tafel meekijken.
	_, v = send(t, s, c, Command{Action: "create", Name: "Solo"})
	if status, x := send(t, s, tv, Command{Action: "watch", Code: v["code"].(string)}); status != 200 {
		t.Fatal(status, x)
	}
}

func TestHostAudioRoute(t *testing.T) {
	h := publicHandler()
	for _, p := range []string{"/audio/host/x.mp3", "/audio/host/../main.go", "/audio/host/manifest.json", "/audio/host/"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
		if w.Code != 404 {
			t.Fatalf("%s: %d", p, w.Code)
		}
	}
	if _, e := loadHost(); e != nil {
		t.Fatal(e)
	}
}
