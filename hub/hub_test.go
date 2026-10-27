package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

const testHash = "2afc78b45293acd677ffcba91f53fea50838d406d2dd965846e83408657e58c7"

func testServer(t *testing.T) (*server, string) {
	t.Helper()
	store, err := openStore(filepath.Join(t.TempDir(), "hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	s := &server{store: store, sessions: newSessions([]byte("k"), ""), limits: newLimiter()}
	token, _ := s.sessions.Issue()
	return s, token
}

func file(nick string) string {
	f := map[string]any{
		"format": 1, "hash": testHash, "width": 620, "height": 900, "srcLang": "hu", "lang": "en", "nick": nick,
		"panels": []any{map[string]any{"id": "p0"}}, "regions": []any{map[string]any{"id": "r0"}},
		"scene": map[string]any{"summary": "x"}, "translation": map[string]any{"r0": map[string]any{"text": "HI"}},
	}
	b, _ := json.Marshal(f)
	return string(b)
}

func post(s *server, token, body, secret string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/comics/"+testHash+"/translations", strings.NewReader(body))
	r.SetPathValue("hash", testHash)
	r.Header.Set("X-Session", token)
	r.Header.Set("X-Nick-Secret", secret)
	w := httptest.NewRecorder()
	s.authed(s.contribute)(w, r)
	return w
}

func TestSessions(t *testing.T) {
	s := newSessions([]byte("key"), "")
	token, _ := s.Issue()
	if !s.Valid(token) {
		t.Fatal("fresh token rejected")
	}
	if s.Valid(token+"x") || s.Valid("123.abc.def") || s.Valid("") {
		t.Fatal("forged token accepted")
	}
	if newSessions([]byte("other"), "").Valid(token) {
		t.Fatal("token valid under another key")
	}
}

func TestContributeAndList(t *testing.T) {
	s, token := testServer(t)
	if w := post(s, "", file(""), ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("no session: %d", w.Code)
	}
	w := post(s, token, file(""), "")
	if w.Code != http.StatusCreated {
		t.Fatalf("anonymous post: %d %s", w.Code, w.Body)
	}
	again := post(s, token, file(""), "")
	if again.Body.String() != w.Body.String() {
		t.Fatalf("same file twice got a new id: %s vs %s", again.Body, w.Body)
	}
	secret := strings.Repeat("a", 32)
	if w := post(s, token, file("Piri"), secret); w.Code != http.StatusCreated {
		t.Fatalf("nick post: %d %s", w.Code, w.Body)
	}
	if w := post(s, token, file("piri"), strings.Repeat("b", 32)); w.Code != http.StatusConflict {
		t.Fatalf("stolen nick: %d %s", w.Code, w.Body)
	}
	list, err := s.store.ByHash(testHash)
	if err != nil || len(list) != 2 {
		t.Fatalf("listing: %v %+v", err, list)
	}
	mine, _ := s.store.ByNick("PIRI")
	if len(mine) != 1 || mine[0].Hash != testHash {
		t.Fatalf("by nick: %+v", mine)
	}
}

func TestContributeRejectsBadFiles(t *testing.T) {
	s, token := testServer(t)
	bad := strings.Replace(file(""), `"lang":"en"`, `"lang":"<script>"`, 1)
	if w := post(s, token, bad, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad lang: %d", w.Code)
	}
	other := strings.Replace(file(""), testHash, strings.Repeat("0", 64), 1)
	if w := post(s, token, other, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("hash mismatch: %d", w.Code)
	}
}

func TestPublicOnly(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:80", "10.0.0.1:80", "192.168.1.1:443", "169.254.169.254:80", "[::1]:80", "100.64.0.1:80", "0.0.0.0:80"} {
		if publicOnly("tcp", addr, nil) == nil {
			t.Errorf("%s allowed", addr)
		}
	}
	if err := publicOnly("tcp", "1.1.1.1:443", nil); err != nil {
		t.Errorf("public address refused: %v", err)
	}
}
