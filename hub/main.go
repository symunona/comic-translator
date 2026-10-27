// hub is the small public backend of comic-translator: it keeps shared
// translation files per image hash. Images never reach it, LLM calls never
// pass through it.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const maxBodyBytes = 1 << 20

var (
	hashRe = regexp.MustCompile(`^[0-9a-f]{64}$`)
	langRe = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z]{2,4})?$`)
	nickRe = regexp.MustCompile(`^[\p{L}\p{N}_. -]{2,32}$`)
)

type server struct {
	store    *Store
	sessions *Sessions
	siteKey  string
	limits   *limiter
}

func main() {
	addr := flag.String("addr", "127.0.0.1:4750", "listen address")
	data := flag.String("data", "data-hub", "data directory (sqlite db, session key)")
	static := flag.String("static", "", "built frontend to serve (frontend/dist)")
	models := flag.String("models", "", "directory with detector .onnx files served at /models/")
	flag.Parse()

	if err := os.MkdirAll(*data, 0o755); err != nil {
		log.Fatal(err)
	}
	store, err := openStore(filepath.Join(*data, "hub.db"))
	if err != nil {
		log.Fatal(err)
	}
	key, err := sessionKey(filepath.Join(*data, "session.key"))
	if err != nil {
		log.Fatal(err)
	}
	s := &server{
		store:    store,
		sessions: newSessions(key, os.Getenv("TURNSTILE_SECRET")),
		siteKey:  os.Getenv("TURNSTILE_SITE_KEY"),
		limits:   newLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", s.config)
	mux.HandleFunc("POST /api/session", s.limit("session", 30, s.session))
	mux.HandleFunc("GET /api/comics/{hash}", s.limit("read", 1200, s.authed(s.comic)))
	mux.HandleFunc("POST /api/comics/{hash}/translations", s.limit("post", 60, s.authed(s.contribute)))
	mux.HandleFunc("GET /api/translations/{id}", s.limit("read", 1200, s.authed(s.translation)))
	mux.HandleFunc("GET /api/nicks/{nick}", s.limit("read", 1200, s.nick))
	mux.HandleFunc("GET /api/fetch", s.limit("fetch", 60, s.fetch))
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	if *models != "" {
		mux.Handle("GET /models/", immutable(http.StripPrefix("/models/", http.FileServer(http.Dir(*models)))))
	}
	if *static != "" {
		mux.Handle("GET /", spa(*static))
	}
	log.Printf("hub on %s, data %s, captcha %v", *addr, *data, s.siteKey != "")
	srv := &http.Server{Addr: *addr, Handler: logRequests(mux), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func sessionKey(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil {
		return hex.DecodeString(strings.TrimSpace(string(b)))
	}
	key := make([]byte, 32)
	rand.Read(key)
	return key, os.WriteFile(path, []byte(hex.EncodeToString(key)), 0o600)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	http.Error(w, msg, code)
}

// clientIP trusts X-Forwarded-For only from a local reverse proxy (Caddy).
func clientIP(r *http.Request) string {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	return host
}

func (s *server) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"turnstileSiteKey": s.siteKey})
}

func (s *server) session(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&in); err != nil || in.Token == "" {
		fail(w, 400, "missing captcha token")
		return
	}
	if err := s.sessions.Verify(r.Context(), in.Token, clientIP(r)); err != nil {
		fail(w, 403, err.Error())
		return
	}
	token, exp := s.sessions.Issue()
	writeJSON(w, 200, map[string]any{"token": token, "exp": exp})
}

func (s *server) authed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.sessions.Valid(r.Header.Get("X-Session")) {
			fail(w, 401, "solve the captcha first")
			return
		}
		h(w, r)
	}
}

func (s *server) comic(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !hashRe.MatchString(hash) {
		fail(w, 400, "bad hash")
		return
	}
	list, err := s.store.ByHash(hash)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"hash": hash, "translations": list})
}

func (s *server) translation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		fail(w, 400, "bad id")
		return
	}
	body, err := s.store.Body(id)
	if errors.Is(err, errNotFound) {
		fail(w, 404, "no such translation")
		return
	} else if err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=86400, immutable")
	w.Write(body)
}

// sharedFile is the subset of the frontend's SharedTranslation the hub checks.
type sharedFile struct {
	Format      int                        `json:"format"`
	Hash        string                     `json:"hash"`
	Width       int                        `json:"width"`
	Height      int                        `json:"height"`
	SrcLang     string                     `json:"srcLang"`
	Lang        string                     `json:"lang"`
	Nick        string                     `json:"nick"`
	Regions     []json.RawMessage          `json:"regions"`
	Panels      []json.RawMessage          `json:"panels"`
	Scene       json.RawMessage            `json:"scene"`
	Translation map[string]json.RawMessage `json:"translation"`
}

func (f *sharedFile) check(hash string) string {
	switch {
	case f.Format != 1:
		return "unknown format"
	case f.Hash != hash:
		return "hash does not match the url"
	case f.Width <= 0 || f.Height <= 0 || f.Width > 50000 || f.Height > 100000:
		return "bad size"
	case !langRe.MatchString(f.Lang):
		return "bad lang"
	case f.SrcLang != "" && !langRe.MatchString(f.SrcLang):
		return "bad srcLang"
	case len(f.Translation) == 0 || len(f.Translation) > 1000:
		return "translation is empty or too large"
	case len(f.Regions) == 0 || len(f.Regions) > 1000 || len(f.Panels) == 0 || len(f.Panels) > 200:
		return "bad regions or panels"
	case len(f.Scene) == 0 || f.Scene[0] != '{':
		return "missing scene"
	}
	return ""
}

func (s *server) contribute(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !hashRe.MatchString(hash) {
		fail(w, 400, "bad hash")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil || len(body) > maxBodyBytes {
		fail(w, 413, "translation file over 1 MB")
		return
	}
	var f sharedFile
	if err := json.Unmarshal(body, &f); err != nil {
		fail(w, 400, "not a translation file: "+err.Error())
		return
	}
	if msg := f.check(hash); msg != "" {
		fail(w, 400, msg)
		return
	}
	nick := strings.TrimSpace(f.Nick)
	if nick != "" {
		if len(r.Header.Get("X-Nick-Secret")) < 16 {
			fail(w, 400, "missing nickname secret")
			return
		}
		if !nickRe.MatchString(nick) || !utf8.ValidString(nick) {
			fail(w, 400, "nickname: 2-32 letters, digits, space, dot, dash or underscore")
			return
		}
		if err := s.store.ClaimNick(nick, r.Header.Get("X-Nick-Secret")); errors.Is(err, errNickTaken) {
			fail(w, 409, "that nickname belongs to someone else, pick another one")
			return
		} else if err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	id, err := s.store.Add(Contribution{Hash: hash, Lang: f.Lang, SrcLang: f.SrcLang, Nick: nick, IP: clientIP(r), Body: body})
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	log.Printf("contribution %d: %s… %s->%s nick=%q %d bytes", id, hash[:8], f.SrcLang, f.Lang, nick, len(body))
	writeJSON(w, 201, map[string]int64{"id": id})
}

func (s *server) nick(w http.ResponseWriter, r *http.Request) {
	nick := r.PathValue("nick")
	if !nickRe.MatchString(nick) {
		fail(w, 400, "bad nickname")
		return
	}
	list, err := s.store.ByNick(nick)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"nick": nick, "translations": list})
}

func (s *server) fetch(w http.ResponseWriter, r *http.Request) {
	data, mime, err := fetchImage(r.URL.Query().Get("url"))
	if err != nil {
		fail(w, 422, err.Error())
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Write(data)
}

type window struct {
	n     int
	reset time.Time
}

// limiter is a fixed one-hour window per (bucket, client ip).
type limiter struct {
	mu sync.Mutex
	m  map[string]*window
}

func newLimiter() *limiter {
	l := &limiter{m: map[string]*window{}}
	go func() {
		for range time.Tick(10 * time.Minute) {
			l.mu.Lock()
			for k, v := range l.m {
				if time.Now().After(v.reset) {
					delete(l.m, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

func (l *limiter) allow(key string, perHour int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	w, ok := l.m[key]
	if !ok || time.Now().After(w.reset) {
		w = &window{reset: time.Now().Add(time.Hour)}
		l.m[key] = w
	}
	w.n++
	return w.n <= perHour
}

func (s *server) limit(bucket string, perHour int, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limits.allow(bucket+"|"+clientIP(r), perHour) {
			fail(w, 429, "too many requests, try again later")
			return
		}
		h(w, r)
	}
}

func immutable(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		h.ServeHTTP(w, r)
	})
}

// spa serves the built frontend; unknown paths get index.html so client routes work on reload.
func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Clean("/" + r.URL.Path)
		if st, err := os.Stat(filepath.Join(dir, p)); err != nil || st.IsDir() && p != "/" {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		if strings.HasPrefix(p, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			h.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		h.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.code, time.Since(start).Round(time.Millisecond))
	})
}
