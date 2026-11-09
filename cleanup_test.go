package main

import (
	"testing"
	"testing/synctest"
	"time"
)

func TestNewSessionCannotEraseLiveRetryLedger(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// synctest starts in 2000; move past the approved catalog's verified dates.
		time.Sleep(time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC).Sub(time.Now()))
		s := setup(t)
		_, _, c := req(t, s, "", "/api/session", "")
		body := `{"id":"create-stable-0001","action":"create","name":"Stable"}`
		st, before, _ := req(t, s, c, "/api/command", body)
		if st != 200 {
			t.Fatal(st, before)
		}
		// Advance the virtual clock across a Unix second, without wall-clock sleeps.
		time.Sleep(time.Second)
		if st, _, _ := req(t, s, "", "/api/session", ""); st != 200 {
			t.Fatal(st)
		}
		var n int
		if err := s.db.QueryRow(`SELECT count(*) FROM commands WHERE id='create-stable-0001'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("live retry ledger rows = %d, want 1", n)
		}
		st, after, _ := req(t, s, c, "/api/command", body)
		if st != 200 || after["code"] != before["code"] || after["version"] != before["version"] {
			t.Fatal("new session erased retry ledger", st, after)
		}
	})
}
func TestNewSessionDeletesOnlyExpiredRows(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		// synctest starts in 2000; move past the approved catalog's verified dates.
		time.Sleep(time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC).Sub(time.Now()))
		s := setup(t)
		now := time.Now().Unix()
		cutoff := now - 86400*7
		for _, row := range []struct {
			name string
			time int64
		}{
			{"expired", now - 1},
			{"boundary", now},
			{"live", now + 1},
		} {
			if _, err := s.db.Exec(`INSERT INTO sessions(hash,expires) VALUES(?,?)`, row.name, row.time); err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.Exec(`INSERT INTO rooms VALUES(?,'{}',?)`, row.name, row.time); err != nil {
				t.Fatal(err)
			}
		}
		for _, row := range []struct {
			name string
			time int64
		}{
			{"expired", cutoff - 1},
			{"boundary", cutoff},
			{"live", cutoff + 1},
			{"recent", now - 60},
		} {
			if _, err := s.db.Exec(`INSERT INTO commands VALUES(?,'test','{}','ROOM',?)`, row.name, row.time); err != nil {
				t.Fatal(err)
			}
		}
		if st, _, _ := req(t, s, "", "/api/session", ""); st != 200 {
			t.Fatal(st)
		}
		for _, table := range []struct {
			name, key string
			rows      []string
		}{
			{"sessions", "hash", []string{"expired", "boundary", "live"}},
			{"rooms", "code", []string{"expired", "boundary", "live"}},
			{"commands", "actor", []string{"expired", "boundary", "live", "recent"}},
		} {
			for _, row := range table.rows {
				var n int
				if err := s.db.QueryRow(`SELECT count(*) FROM `+table.name+` WHERE `+table.key+`=?`, row).Scan(&n); err != nil {
					t.Fatal(err)
				}
				want := 1
				if row == "expired" {
					want = 0
				}
				if n != want {
					t.Errorf("%s %s rows = %d, want %d", table.name, row, n, want)
				}
			}
		}
	})
}

func TestNewSessionCannotResetCommandQuota(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		time.Sleep(time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC).Sub(time.Now()))
		s := setup(t)
		_, _, cookie := req(t, s, "", "/api/session", "")
		body := `{"id":"quota-create-0001","action":"create","name":"Quota"}`
		st, before, _ := req(t, s, cookie, "/api/command", body)
		if st != 200 {
			t.Fatal(st, before)
		}
		// Together with create, these are exactly the existing 5,000-command cap.
		if _, err := s.db.Exec(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<4999)
			INSERT INTO commands SELECT actor,printf('quota-%d',i),'{}',room,created FROM commands,n WHERE id='quota-create-0001'`); err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Second)
		if st, _, _ := req(t, s, "", "/api/session", ""); st != 200 {
			t.Fatal(st)
		}
		if st, _, _ := req(t, s, cookie, "/api/command", `{"id":"over-quota-0001","action":"configure","turns":1,"version":1}`); st != 429 {
			t.Errorf("new session reset command quota: status %d, want 429", st)
		}
		st, after, _ := req(t, s, cookie, "/api/command", body)
		if st != 200 || after["code"] != before["code"] || after["version"] != before["version"] {
			t.Fatal("exact replay at quota must remain available", st, after)
		}
	})
}

func TestNewSessionCleanupRollsBackOnStorageFailure(t *testing.T) {
	s := setup(t)
	for _, query := range []string{
		`INSERT INTO sessions(hash,expires) VALUES('expired',0)`,
		`INSERT INTO commands VALUES('expired','old','{}','EXPIRE',0)`,
		`INSERT INTO rooms VALUES('EXPIRE','{}',0)`,
		`CREATE TRIGGER fail_cleanup BEFORE DELETE ON rooms BEGIN SELECT RAISE(ABORT,'cleanup failure'); END`,
	} {
		if _, err := s.db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if st, _, cookie := req(t, s, "", "/api/session", ""); st != 503 || cookie != "" {
		t.Fatalf("failed cleanup: status %d cookie issued %v", st, cookie != "")
	}
	for _, query := range []string{
		`SELECT count(*) FROM sessions WHERE hash='expired'`,
		`SELECT count(*) FROM commands WHERE actor='expired'`,
		`SELECT count(*) FROM rooms WHERE code='EXPIRE'`,
	} {
		var n int
		if err := s.db.QueryRow(query).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("partial cleanup after failure: %s = %d, want 1", query, n)
		}
	}
}
