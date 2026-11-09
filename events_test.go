package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSSEAuthorizationRevisionPrivacyAndReconnect(t *testing.T) {
	s := setup(t)
	cs, v := table(t, s)
	_, v = cmd(t, s, cs[0], v, "start", "")
	_, v = cmd(t, s, cs[0], v, "deal", "")
	server := httptest.NewServer(s)
	defer server.Close()
	for _, c := range []string{"", func() string { _, _, c := req(t, s, "", "/api/session", ""); return c }()} {
		r, _ := http.NewRequest("GET", server.URL+"/api/events", nil)
		r.Header.Set("Cookie", c)
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 404 {
			t.Fatal("nonmember stream", res.StatusCode)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	connect := func() (*http.Response, *bufio.Reader) {
		r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/events", nil)
		r.Header.Set("Cookie", cs[0])
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Type"), "text/event-stream") || res.Header.Get("X-Accel-Buffering") != "no" {
			res.Body.Close()
			t.Fatal("not SSE", res.StatusCode, res.Header)
		}
		return res, bufio.NewReader(res.Body)
	}
	response, reader := connect()
	line := readEvent(t, reader)
	if !strings.Contains(line, fmt.Sprintf(`"version":%v`, v["version"])) || strings.Contains(line, "TEST") || strings.Contains(line, "role") || strings.Contains(line, "answer") {
		response.Body.Close()
		t.Fatal("leaky/missing initial projection", line)
	}
	_, v = cmd(t, s, cs[0], v, "bank", "")
	line = readEvent(t, reader)
	if !strings.Contains(line, fmt.Sprintf(`"version":%v`, v["version"])) || strings.Contains(line, "TEST") {
		t.Fatal(line)
	}
	response.Body.Close()
	response, reader = connect()
	defer response.Body.Close()
	line = readEvent(t, reader)
	if !strings.Contains(line, fmt.Sprintf(`"version":%v`, v["version"])) {
		t.Fatal("reconnect not resynced", line)
	}
}
func readEvent(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	var b strings.Builder
	for {
		line, e := r.ReadString('\n')
		if e != nil {
			t.Fatal(e)
		}
		b.WriteString(line)
		if line == "\n" && strings.Contains(b.String(), "data:") {
			return b.String()
		}
	}
}
