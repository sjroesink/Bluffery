package main

import (
	"context"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

//go:embed dist
var publicFS embed.FS

func publicHandler() http.Handler {
	root, _ := fs.Sub(publicFS, "dist")
	_ = root
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		if strings.Contains(path, "..") || strings.HasSuffix(path, "/") {
			http.NotFound(w, r)
			return
		}
		if _, e := fs.Stat(root, strings.TrimPrefix(path, "/")); e != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if path == "/sw.js" {
			w.Header().Set("Cache-Control", "no-cache, no-store")
			w.Header().Set("Cloudflare-CDN-Cache-Control", "no-store")
			w.Header().Set("Service-Worker-Allowed", "/")
		}
		if path == "/manifest.webmanifest" {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		data, err := fs.ReadFile(root, strings.TrimPrefix(path, "/"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeContent(w, r, path, time.Time{}, strings.NewReader(string(data)))
	})
}
func env(k, def string) string {
	if s := os.Getenv(k); s != "" {
		return s
	}
	return def
}
func fixtureSafe(origin, listen string) bool {
	u, e := url.Parse(origin)
	if e != nil {
		return false
	}
	isLoop := func(host string) bool {
		if host == "localhost" {
			return true
		}
		ip := net.ParseIP(host)
		return ip != nil && ip.IsLoopback()
	}
	host, _, e := net.SplitHostPort(listen)
	return e == nil && isLoop(u.Hostname()) && isLoop(host)
}
func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		addr := env("LISTEN_ADDR", ":8080")
		_, port, e := net.SplitHostPort(addr)
		if e != nil {
			os.Exit(1)
		}
		r, e := client.Get("http://127.0.0.1:" + port + "/healthz")
		if e != nil {
			os.Exit(1)
		}
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
		if r.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "catalog" {
		if len(os.Args) != 3 {
			log.Fatal("usage: vissig catalog path.json")
		}
		if e := catalogCommand(os.Args[2]); e != nil {
			log.Fatal(e)
		}
		return
	}
	origin := env("PUBLIC_BASE_URL", "http://localhost:8080")
	u, e := url.Parse(origin)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		log.Fatal("PUBLIC_BASE_URL must be an exact http(s) origin")
	}
	fixtures := os.Getenv("VISSIG_DEV_FIXTURES") == "1"
	if fixtures && !fixtureSafe(origin, env("LISTEN_ADDR", ":8080")) {
		log.Fatal("development fixtures allowed only on loopback origins")
	}
	s, e := openServer(env("DATA_DIR", "./data"), strings.TrimRight(origin, "/"), fixtures)
	if e != nil {
		log.Fatal(e)
	}
	defer s.db.Close()
	for _, value := range strings.Split(os.Getenv("TRUSTED_PROXY_CIDRS"), ",") {
		if strings.TrimSpace(value) == "" {
			continue
		}
		_, cidr, e := net.ParseCIDR(strings.TrimSpace(value))
		if e != nil {
			log.Fatal("invalid TRUSTED_PROXY_CIDRS")
		}
		s.proxies = append(s.proxies, cidr)
	}
	s.static = publicHandler()
	server := &http.Server{Addr: env("LISTEN_ADDR", ":8080"), Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 8192}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()
	fmt.Printf("Vissig listening on %s (fixtures=%v, catalog=%d)\n", server.Addr, fixtures, len(s.questions))
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
