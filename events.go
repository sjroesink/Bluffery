package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Revision-only events: no game questions, identities, roles or answers enter the hub.
// Subscribers always perform a separate authenticated personal state fetch.
type eventSubscriber struct {
	actor, ip, room string
	wake            chan struct{}
}
type eventHub struct {
	mu      sync.Mutex
	members map[*eventSubscriber]bool
}

func (h *eventHub) subscribe(actor, ip, room string) (*eventSubscriber, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.members == nil {
		h.members = map[*eventSubscriber]bool{}
	}
	if len(h.members) >= 1024 {
		return nil, false
	}
	sameActor, sameIP := 0, 0
	for sub := range h.members {
		if sub.actor == actor {
			sameActor++
		}
		if sub.ip == ip {
			sameIP++
		}
	}
	if sameActor >= 3 || sameIP >= 64 {
		return nil, false
	}
	sub := &eventSubscriber{actor: actor, ip: ip, room: room, wake: make(chan struct{}, 1)}
	h.members[sub] = true
	return sub, true
}
func (h *eventHub) remove(sub *eventSubscriber) { h.mu.Lock(); delete(h.members, sub); h.mu.Unlock() }
func (h *eventHub) notify(room Room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for sub := range h.members { // Removed members wake too, so they fail authorization immediately.
		if sub.room != room.Code {
			continue
		}
		select {
		case sub.wake <- struct{}{}:
		default:
		}
	}
}
func (s *Server) events(w http.ResponseWriter, r *http.Request, actor string) {
	room, e := s.readRoom(actor)
	if e != nil {
		fail(w, 404, "Geen actieve kamer gevonden.")
		return
	}
	sub, ok := s.eventsHub.subscribe(actor, s.clientIP(r), room.Code)
	if !ok {
		w.Header().Set("Retry-After", "10")
		fail(w, 429, "Te veel open verbindingen. Sluit een ander tabblad.")
		return
	}
	defer s.eventsHub.remove(sub)
	room, e = s.readRoom(actor)
	if e != nil {
		fail(w, 404, "Geen actieve kamer gevonden.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Cloudflare-CDN-Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	write := func(event string, data any) bool {
		controller := http.NewResponseController(w)
		if controller.SetWriteDeadline(time.Now().Add(5*time.Second)) != nil {
			return false
		}
		b, _ := json.Marshal(data)
		if _, e := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b); e != nil {
			return false
		}
		return controller.Flush() == nil
	}
	if !write("revision", map[string]int{"version": room.Version}) {
		return
	}
	last := room.Version
	ticker := time.NewTicker(12 * time.Second)
	defer ticker.Stop()
	ctx := r.Context()
	for {
		heartbeat := false
		select {
		case <-ctx.Done():
			return
		case <-sub.wake:
		case <-ticker.C:
			heartbeat = true
		}
		room, e = s.readRoom(actor)
		if e != nil {
			write("expired", map[string]bool{"expired": true})
			return
		}
		if room.Version != last {
			if !write("revision", map[string]int{"version": room.Version}) {
				return
			}
			last = room.Version
		} else if heartbeat {
			controller := http.NewResponseController(w)
			controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, e = fmt.Fprint(w, ": heartbeat\n\n"); e != nil || controller.Flush() != nil {
				return
			}
		}
		if e = context.Cause(ctx); e != nil {
			return
		}
	}
}
