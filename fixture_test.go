package main

import "testing"

func TestFixtureBoundary(t *testing.T) {
	for _, tc := range []struct {
		origin, listen string
		want           bool
	}{{"http://127.0.0.1:1", "127.0.0.1:1", true}, {"http://localhost:1", "[::1]:1", true}, {"https://vissig.roesink.dev", ":8080", false}, {"http://localhost:1", ":8080", false}, {"http://localhost:1", "localhost:8080", true}} {
		if fixtureSafe(tc.origin, tc.listen) != tc.want {
			t.Fatal(tc)
		}
	}
}
