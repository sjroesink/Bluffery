package main

import (
	"net/http/httptest"
	"testing"
)

func TestAudioRoute(t *testing.T) {
	h := publicHandler()
	for _, p := range []string{"/audio/q_missing.mp3", "/audio/.gitkeep", "/audio/x/../../main.go", "/audio/"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
		if w.Code != 404 {
			t.Fatalf("%s: %d", p, w.Code)
		}
	}
	if questionAudio("q_missing") != "" {
		t.Fatal("audio for unknown question")
	}
}
