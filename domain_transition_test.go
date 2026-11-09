package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Exercise the real startup configuration without ever touching production.
func TestDomainTransitionProcess(t *testing.T) {
	if os.Getenv("BLUFFERY_DOMAIN_TEST_PROCESS") == "1" {
		main()
		os.Exit(0)
	}
}

func domainProcess(t *testing.T, dir, addr, canonical, legacy string) (*exec.Cmd, *bytes.Buffer) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestDomainTransitionProcess$")
	for _, value := range os.Environ() {
		key := strings.SplitN(value, "=", 2)[0]
		switch key {
		case "PUBLIC_BASE_URL", "LEGACY_PUBLIC_BASE_URL", "BLUFFERY_DEV_FIXTURES", "DATA_DIR", "LISTEN_ADDR", "TRUSTED_PROXY_CIDRS", "BLUFFERY_DOMAIN_TEST_PROCESS":
			continue
		}
		cmd.Env = append(cmd.Env, value)
	}
	cmd.Env = append(cmd.Env, "BLUFFERY_DOMAIN_TEST_PROCESS=1", "BLUFFERY_DEV_FIXTURES=1", "DATA_DIR="+dir, "LISTEN_ADDR="+addr, "PUBLIC_BASE_URL="+canonical, "LEGACY_PUBLIC_BASE_URL="+legacy)
	output := new(bytes.Buffer)
	cmd.Stdout = output
	cmd.Stderr = output
	return cmd, output
}

func domainAddress(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return addr
}

func startDomainProcess(t *testing.T, dir, addr, canonical, legacy string) func() {
	t.Helper()
	cmd, output := domainProcess(t, dir, addr, canonical, legacy)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	stopped := false
	stop := func() {
		if !stopped {
			stopped = true
			cmd.Process.Kill()
			<-done
		}
	}
	t.Cleanup(stop)
	client := &http.Client{Timeout: 100 * time.Millisecond}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			stopped = true
			t.Fatalf("startup: %v: %s", err, output.String())
		default:
		}
		res, err := client.Get("http://" + addr + "/healthz")
		if err == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				return stop
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	stop()
	t.Fatalf("startup timed out: %s", output.String())
	return nil
}

func domainRequest(t *testing.T, client *http.Client, base, path, origin, site, body string) (*http.Response, map[string]any) {
	t.Helper()
	method := "GET"
	if body != "" {
		method = "POST"
	}
	req, err := http.NewRequest(method, base+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", origin)
	req.Header.Set("Sec-Fetch-Site", site)
	req.Header.Set("Content-Type", "application/json")
	// These headers must never establish an additional trusted origin.
	req.Header.Set("X-Forwarded-Host", "evil.invalid")
	req.Header.Set("X-Forwarded-Proto", "https")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	json.Unmarshal(b, &value)
	if res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unexpected CORS trust")
	}
	return res, value
}

func TestDomainTransitionRejectsInvalidConfiguration(t *testing.T) {
	cases := []struct{ canonical, legacy, message string }{
		{"http://localhost:8080", "http://user:secret@localhost:8081", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://localhost:8081/path", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://localhost:8081/", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://localhost:8081?x=1", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://localhost:8081?", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://localhost:8081#x", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://localhost:8081#", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "ftp://localhost:8081", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http:///missing", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "null", "LEGACY_PUBLIC_BASE_URL"},
		{"https://localhost:8080", "http://localhost:8081", "LEGACY_PUBLIC_BASE_URL"},
		{"http://localhost:8080", "http://example.invalid", "loopback"},
		{"http://example.invalid", "http://localhost:8081", "loopback"},
		{"http://localhost:8080/", "", "PUBLIC_BASE_URL"},
	}
	for i, tc := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			cmd, output := domainProcess(t, t.TempDir(), domainAddress(t), tc.canonical, tc.legacy)
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			select {
			case err := <-done:
				if err == nil || !strings.Contains(output.String(), tc.message) {
					t.Fatalf("wrong validation: %v: %s", err, output.String())
				}
			case <-time.After(750 * time.Millisecond):
				cmd.Process.Kill()
				<-done
				t.Fatalf("invalid origin configuration started server: canonical=%q legacy=%q", tc.canonical, tc.legacy)
			}
		})
	}
}

func TestDomainTransitionDefaultIsExactOnly(t *testing.T) {
	s := setup(t)
	for _, origin := range []string{s.origin, "", "http://127.0.0.1:8080", s.origin + "/", s.origin + ".evil.invalid", "null"} {
		for _, path := range []string{"/api/session", "/api/command"} {
			method, body := "GET", ""
			if path == "/api/command" {
				method, body = "POST", `{}`
			}
			r := httptest.NewRequest(method, path, strings.NewReader(body))
			r.Host = "127.0.0.1:8080"
			r.Header.Set("Origin", origin)
			r.Header.Set("X-Forwarded-Host", "127.0.0.1:8080")
			r.Header.Set("X-Forwarded-Proto", "http")
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			allowed := origin == s.origin || (origin == "" && method == "GET")
			if allowed == (w.Code == 403) {
				t.Fatalf("default origin %q %s: %d", origin, path, w.Code)
			}
		}
	}
}

func TestDomainTransitionHTTPSCookieRemainsHostOnly(t *testing.T) {
	s := setup(t)
	s.origin = "https://bluffery.roesink.dev"
	s.legacyOrigin = "https://vissig.roesink.dev"
	for _, origin := range []string{s.origin, s.legacyOrigin} {
		r := httptest.NewRequest("GET", origin+"/api/session", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		cookies := w.Result().Cookies()
		if w.Code != 200 || len(cookies) != 1 {
			t.Fatalf("session %s: %d", origin, w.Code)
		}
		c := cookies[0]
		if c.Name != "vissig" || c.Domain != "" || !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" {
			t.Fatal("cookie attributes changed")
		}
	}
}

func TestDomainTransitionPreservesOldBrowserSession(t *testing.T) {
	dir, addr := t.TempDir(), domainAddress(t)
	_, port, _ := net.SplitHostPort(addr)
	oldURL, newURL := "http://"+addr, "http://localhost:"+port
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 3 * time.Second}
	stop := startDomainProcess(t, dir, addr, oldURL, "")
	res, _ := domainRequest(t, client, oldURL, "/api/session", oldURL, "same-origin", "")
	if res.StatusCode != 200 || len(res.Cookies()) != 1 {
		t.Fatal("initial session", res.StatusCode)
	}
	original := res.Cookies()[0]
	if original.Domain != "" || !original.HttpOnly || original.SameSite != http.SameSiteStrictMode {
		t.Fatal("cookie widened")
	}
	res, before := domainRequest(t, client, oldURL, "/api/command", oldURL, "same-origin", `{"id":"create-old-0001","action":"create","name":"Old player"}`)
	if res.StatusCode != 200 {
		t.Fatal("create", res.StatusCode, before)
	}
	stop()
	startDomainProcess(t, dir, addr, newURL, oldURL)
	res, _ = domainRequest(t, client, oldURL, "/api/session", oldURL, "same-origin", "")
	if res.StatusCode != 200 {
		t.Fatalf("legacy session rejected after canonical transition: %d", res.StatusCode)
	}
	if len(res.Cookies()) != 0 {
		t.Fatal("existing cookie replaced")
	}
	res, after := domainRequest(t, client, oldURL, "/api/state", oldURL, "same-origin", "")
	if res.StatusCode != 200 || after["code"] != before["code"] || after["version"] != before["version"] {
		t.Fatal("old room/role lost", res.StatusCode, after)
	}
	body := fmt.Sprintf(`{"id":"configure-old-0001","action":"configure","turns":2,"version":%v}`, after["version"])
	res, after = domainRequest(t, client, oldURL, "/api/command", oldURL, "same-origin", body)
	if res.StatusCode != 200 || after["turns"] != float64(2) {
		t.Fatal("legacy mutation", res.StatusCode, after)
	}
	streamReq, _ := http.NewRequest("GET", oldURL+"/api/events", nil)
	streamReq.Header.Set("Origin", oldURL)
	stream, err := client.Do(streamReq)
	if err != nil {
		t.Fatal(err)
	}
	stream.Body.Close()
	if stream.StatusCode != 200 || stream.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatal("legacy SSE", stream.StatusCode)
	}
	res, _ = domainRequest(t, client, newURL, "/api/session", newURL, "same-origin", "")
	if res.StatusCode != 200 || len(res.Cookies()) != 1 || res.Cookies()[0].Value == original.Value || res.Cookies()[0].Domain != "" {
		t.Fatal("new host did not get separate host-only identity")
	}
	res, _ = domainRequest(t, client, oldURL, "/api/session", oldURL, "same-origin", "")
	if res.StatusCode != 200 || len(res.Cookies()) != 0 {
		t.Fatal("new host visit invalidated old session")
	}
	oldOrigin, _ := url.Parse(oldURL)
	oldCookies := jar.Cookies(oldOrigin)
	if len(oldCookies) != 1 || oldCookies[0].Value != original.Value {
		t.Fatal("old host-only browser identity changed")
	}
	res, preserved := domainRequest(t, client, oldURL, "/api/state", oldURL, "same-origin", "")
	if res.StatusCode != 200 || preserved["code"] != after["code"] || preserved["version"] != after["version"] {
		t.Fatal("old player lost room after visiting new host")
	}
	for _, origin := range []string{"https://evil.invalid", oldURL + ".evil.invalid", oldURL + "/", "null", oldURL + " " + newURL, "https://" + addr, ""} {
		res, _ = domainRequest(t, client, oldURL, "/api/command", origin, "same-origin", body)
		if res.StatusCode != 403 {
			t.Fatalf("mutation origin %q accepted: %d", origin, res.StatusCode)
		}
		if origin != "" {
			res, _ = domainRequest(t, client, oldURL, "/api/session", origin, "same-origin", "")
			if res.StatusCode != 403 {
				t.Fatalf("session origin %q accepted: %d", origin, res.StatusCode)
			}
		}
	}
	for _, origin := range []string{oldURL, newURL} {
		for _, endpoint := range []string{"/api/session", "/api/command"} {
			payload := ""
			if endpoint == "/api/command" {
				payload = body
			}
			res, _ = domainRequest(t, client, oldURL, endpoint, origin, "cross-site", payload)
			if res.StatusCode != 403 {
				t.Fatal("cross-site accepted", origin, endpoint)
			}
		}
	}
}
