package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const systemPrompt = "You read comic images and answer with exactly one JSON object, no prose, no code fences."

// Client turns a Backend into an LLM: schema hint, one JSON retry, call logs,
// and a concurrency cap shared by every Client built on the same semaphore.
type Client struct {
	Backend Backend
	sem     chan struct{}
}

func NewClient(b Backend, sem chan struct{}) *Client {
	return &Client{Backend: b, sem: sem}
}

func (c *Client) Call(ctx context.Context, prompt string, images []string, schemaHint string) (json.RawMessage, error) {
	if schemaHint != "" {
		prompt += "\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n" + schemaHint
	}
	want := firstKey(schemaHint)
	text, err := c.complete(ctx, prompt, images, 0)
	if err != nil {
		return nil, err
	}
	raw, err := extractWithKey(text, want)
	if err == nil {
		return raw, nil
	}
	retry := prompt + "\n\nYour previous reply was not valid JSON. Return ONLY valid JSON, no prose, no code fences."
	if text, err = c.complete(ctx, retry, images, 1); err != nil {
		return nil, err
	}
	return extractWithKey(text, want)
}

var firstKeyRe = regexp.MustCompile(`^\s*\{\s*"([^"]+)"`)

func firstKey(schemaHint string) string {
	if m := firstKeyRe.FindStringSubmatch(schemaHint); m != nil {
		return m[1]
	}
	return ""
}

// extractWithKey rejects a JSON object lacking the schema's first key: broken
// output can leave only a nested object (one region) valid.
func extractWithKey(text, key string) (json.RawMessage, error) {
	raw, err := ExtractJSON(text)
	if err != nil || key == "" {
		return raw, err
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return nil, errors.New("model output is not a JSON object")
	}
	if _, ok := obj[key]; !ok {
		return nil, fmt.Errorf("model output lacks %q", key)
	}
	return raw, nil
}

func (c *Client) complete(ctx context.Context, prompt string, images []string, attempt int) (string, error) {
	select {
	case c.sem <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	defer func() { <-c.sem }()

	start := time.Now()
	res, err := c.Backend.Complete(ctx, Request{System: systemPrompt, Prompt: prompt, Images: images})
	entry := logEntry{
		Time: start, Backend: backendKind(c.Backend), Model: c.Backend.Name(), Attempt: attempt,
		Prompt: prompt, Images: images, Duration: time.Since(start).Round(time.Millisecond).String(),
	}
	if res != nil {
		entry.Result, entry.CostUSD, entry.Usage = res.Text, res.CostUSD, res.Usage
		entry.NumTurns, entry.ModelUsage = res.Turns, res.ModelUsage
	}
	if err != nil {
		entry.Error = err.Error()
	}
	writeLog(ctx, entry)
	if m := meterFrom(ctx); m != nil {
		m.record(c.Backend.Name(), res, time.Since(start))
	}
	if err != nil {
		return "", fmt.Errorf("%s: %w", c.Backend.Name(), err)
	}
	return res.Text, nil
}

func backendKind(b Backend) string {
	kind, _, _ := strings.Cut(b.Name(), ":")
	return kind
}
