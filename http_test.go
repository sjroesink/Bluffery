package main

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCrossSiteCannotReplaceSession(t *testing.T) {
	s := setup(t)
	r := httptest.NewRequest("GET", "/api/session", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 || w.Header().Get("Set-Cookie") != "" {
		t.Fatal(w.Code, w.Header())
	}
}
func TestStalledBodyDoesNotBlockOtherReaders(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	blocked := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	body := &blockingReader{blocked: blocked, release: release}
	r := httptest.NewRequest("POST", "/api/command", body)
	r.Header.Set("Origin", s.origin)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Cookie", cs[0])
	go func() { defer close(done); s.ServeHTTP(httptest.NewRecorder(), r) }()
	<-blocked
	defer func() { close(release); <-done }()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		st, x, _ := req(t, s, cs[1], "/api/state", "")
		if st != 200 || x["code"] != v["code"] {
			t.Error(st, x)
		}
	}()
	select {
	case <-ctx.Done():
		t.Fatal("body reader blocked state projection")
	case <-readDone:
	}
}

type blockingReader struct {
	blocked, release chan struct{}
	read             bool
}

func (b *blockingReader) Read(p []byte) (int, error) {
	if !b.read {
		b.read = true
		close(b.blocked)
		<-b.release
	}
	return strings.NewReader("{}").Read(p)
}
func (b *blockingReader) Close() error { return nil }
