package main

import (
	"database/sql"
	"encoding/json"
	"time"
)

func saveRoom(tx *sql.Tx, r Room, creating bool) error {
	b, e := json.Marshal(r)
	if e != nil {
		return e
	}
	statement := `INSERT INTO rooms(code,data,expires) VALUES(?,?,?)`
	if !creating {
		statement += ` ON CONFLICT(code) DO UPDATE SET data=excluded.data,expires=excluded.expires`
	}
	_, e = tx.Exec(statement, r.Code, string(b), time.Now().Unix()+86400*7)
	return e
}
