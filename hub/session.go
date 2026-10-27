package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	sessionTTL = 30 * 24 * time.Hour
	siteverify = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
)

// Sessions are HMAC-signed "<exp>.<nonce>" tokens handed out after one
// Turnstile check, so a contributor solves one captcha per month, not per call.
type Sessions struct {
	key    []byte
	secret string
	http   *http.Client
}

func newSessions(signingKey []byte, turnstileSecret string) *Sessions {
	if len(signingKey) == 0 {
		signingKey = make([]byte, 32)
		rand.Read(signingKey)
	}
	return &Sessions{key: signingKey, secret: turnstileSecret, http: &http.Client{Timeout: 10 * time.Second}}
}

func (s *Sessions) sign(payload string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (s *Sessions) Issue() (string, int64) {
	exp := time.Now().Add(sessionTTL).Unix()
	nonce := make([]byte, 9)
	rand.Read(nonce)
	payload := fmt.Sprintf("%d.%s", exp, base64.RawURLEncoding.EncodeToString(nonce))
	return payload + "." + s.sign(payload), exp
}

func (s *Sessions) Valid(token string) bool {
	i := strings.LastIndexByte(token, '.')
	if i < 0 {
		return false
	}
	payload, sig := token[:i], token[i+1:]
	if !hmac.Equal([]byte(sig), []byte(s.sign(payload))) {
		return false
	}
	exp, err := strconv.ParseInt(strings.SplitN(payload, ".", 2)[0], 10, 64)
	return err == nil && time.Now().Unix() < exp
}

// Verify asks Cloudflare whether a Turnstile token is genuine.
func (s *Sessions) Verify(ctx context.Context, token, ip string) error {
	if s.secret == "" {
		return errors.New("captcha not configured")
	}
	form := url.Values{"secret": {s.secret}, "response": {token}, "remoteip": {ip}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, siteverify, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var out struct {
		Success bool     `json:"success"`
		Codes   []string `json:"error-codes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return err
	}
	if !out.Success {
		return fmt.Errorf("captcha rejected: %s", strings.Join(out.Codes, ", "))
	}
	return nil
}
