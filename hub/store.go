package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	_ "modernc.org/sqlite"
)

var (
	errNotFound  = errors.New("not found")
	errNickTaken = errors.New("nickname taken")
)

const schema = `
CREATE TABLE IF NOT EXISTS translations (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	hash       TEXT NOT NULL,
	lang       TEXT NOT NULL,
	src_lang   TEXT NOT NULL,
	nick       TEXT,
	body_sha   TEXT NOT NULL,
	body       BLOB NOT NULL,
	ip_hash    TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS translations_hash ON translations(hash);
CREATE INDEX IF NOT EXISTS translations_nick ON translations(nick);
CREATE UNIQUE INDEX IF NOT EXISTS translations_body ON translations(hash, body_sha);
CREATE TABLE IF NOT EXISTS nicks (
	nick       TEXT PRIMARY KEY COLLATE NOCASE,
	secret_sha TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
`

type Store struct{ db *sql.DB }

func openStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

type Listing struct {
	ID        int64  `json:"id"`
	Hash      string `json:"hash,omitempty"`
	Lang      string `json:"lang"`
	SrcLang   string `json:"srcLang"`
	Nick      string `json:"nick,omitempty"`
	CreatedAt string `json:"createdAt"`
}

func sha(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (s *Store) list(where string, arg any, withHash bool) ([]Listing, error) {
	rows, err := s.db.Query(`SELECT id, hash, lang, src_lang, COALESCE(nick, ''), created_at FROM translations WHERE `+where+` ORDER BY created_at DESC LIMIT 200`, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Listing{}
	for rows.Next() {
		var l Listing
		var created int64
		if err := rows.Scan(&l.ID, &l.Hash, &l.Lang, &l.SrcLang, &l.Nick, &created); err != nil {
			return nil, err
		}
		if !withHash {
			l.Hash = ""
		}
		l.CreatedAt = time.Unix(created, 0).UTC().Format(time.RFC3339)
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) ByHash(hash string) ([]Listing, error) { return s.list("hash = ?", hash, false) }

func (s *Store) ByNick(nick string) ([]Listing, error) { return s.list("nick = ? COLLATE NOCASE", nick, true) }

func (s *Store) Body(id int64) ([]byte, error) {
	var body []byte
	err := s.db.QueryRow(`SELECT body FROM translations WHERE id = ?`, id).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return body, err
}

// ClaimNick binds a nickname to the first secret that uses it.
func (s *Store) ClaimNick(nick, secret string) error {
	want := sha(secret)
	var have string
	err := s.db.QueryRow(`SELECT secret_sha FROM nicks WHERE nick = ?`, nick).Scan(&have)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = s.db.Exec(`INSERT INTO nicks (nick, secret_sha, created_at) VALUES (?, ?, ?)`, nick, want, time.Now().Unix())
		return err
	}
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare([]byte(have), []byte(want)) != 1 {
		return errNickTaken
	}
	return nil
}

type Contribution struct {
	Hash, Lang, SrcLang, Nick, IP string
	Body                          []byte
}

// Add stores a translation file; posting the same file twice returns the first id.
func (s *Store) Add(c Contribution) (int64, error) {
	bodySha := sha(string(c.Body))
	var id int64
	err := s.db.QueryRow(`SELECT id FROM translations WHERE hash = ? AND body_sha = ?`, c.Hash, bodySha).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	var nick any
	if c.Nick != "" {
		nick = c.Nick
	}
	res, err := s.db.Exec(`INSERT INTO translations (hash, lang, src_lang, nick, body_sha, body, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		c.Hash, c.Lang, c.SrcLang, nick, bodySha, c.Body, sha(c.IP)[:16], time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
