package main

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSSEBoundedCleanupAndRemoval(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	server := httptest.NewServer(s)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	responses := []*http.Response{}
	for i := 0; i < 4; i++ {
		r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/events", nil)
		r.Header.Set("Cookie", cs[1])
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		if i == 3 {
			if res.StatusCode != 429 {
				res.Body.Close()
				t.Fatal("subscriber limit missing", res.StatusCode)
			}
			res.Body.Close()
			break
		}
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		responses = append(responses, res)
		readEvent(t, bufio.NewReader(res.Body))
	}
	_, p, _ := req(t, s, cs[1], "/api/state", "")
	if st, _ := cmd(t, s, cs[0], v, "remove", p["me"].(string)); st != 200 {
		t.Fatal(st)
	}
	for _, res := range responses {
		b, e := io.ReadAll(res.Body)
		res.Body.Close()
		if e != nil || !strings.Contains(string(b), "event: expired") || strings.Contains(string(b), "answer") {
			t.Fatal(string(b), e)
		}
	}
	s.eventsHub.mu.Lock()
	defer s.eventsHub.mu.Unlock()
	if len(s.eventsHub.members) != 0 {
		t.Fatal("subscribers leaked", len(s.eventsHub.members))
	}
}
func TestSSEHeartbeatSurvivesProductionTimeouts(t *testing.T) {
	s := setup(t)
	cs, _ := table(t, s)
	server := httptest.NewUnstartedServer(s)
	server.Config.WriteTimeout = 10 * time.Second
	server.Start()
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 16*time.Second)
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/events", nil)
	r.Header.Set("Cookie", cs[0])
	res, e := http.DefaultClient.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	reader := bufio.NewReader(res.Body)
	readEvent(t, reader)
	line, e := reader.ReadString('\n')
	if e != nil || line != ": heartbeat\n" {
		t.Fatal("stream did not survive server timeouts", line, e)
	}
}
