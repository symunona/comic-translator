package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type LLM interface {
	Call(ctx context.Context, prompt string, images []string, schemaHint string) (json.RawMessage, error)
}

// Backend sends one request to one model and reports what it cost.
type Backend interface {
	Name() string
	Complete(ctx context.Context, req Request) (*Response, error)
}

type Request struct {
	System string
	Prompt string
	Images []string
}

type Response struct {
	Text       string
	Usage      *Usage
	CostUSD    float64
	Turns      int
	ModelUsage json.RawMessage
}

type logKey struct{}

type stageCtxKey struct{}

// WithStage tags calls with the pipeline stage (ocr, scene, translate, review)
// so a Router can send each stage to its own backend.
func WithStage(ctx context.Context, stage string) context.Context {
	return context.WithValue(ctx, stageCtxKey{}, stage)
}

func stageFrom(ctx context.Context) string {
	s, _ := ctx.Value(stageCtxKey{}).(string)
	return s
}

type logTarget struct {
	dir, name string
}

// WithLog makes Call write prompt and raw result to dir/<name>-<n>.json.
func WithLog(ctx context.Context, dir, name string) context.Context {
	return context.WithValue(ctx, logKey{}, logTarget{dir, name})
}

var logMu sync.Mutex

func writeLog(ctx context.Context, entry any) {
	t, ok := ctx.Value(logKey{}).(logTarget)
	if !ok {
		return
	}
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return
	}
	logMu.Lock()
	defer logMu.Unlock()
	if err := os.MkdirAll(t.dir, 0o755); err != nil {
		return
	}
	for n := 0; ; n++ {
		path := filepath.Join(t.dir, fmt.Sprintf("%s-%d.json", t.name, n))
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err == nil {
			f.Write(data)
			f.Close()
		}
		return
	}
}

type logEntry struct {
	Time     time.Time       `json:"time"`
	Backend  string          `json:"backend,omitempty"`
	Model    string          `json:"model"`
	Attempt  int             `json:"attempt"`
	Prompt   string          `json:"prompt"`
	Images   []string        `json:"images"`
	Duration string          `json:"duration"`
	CostUSD  float64         `json:"costUsd,omitempty"`
	Usage    *Usage          `json:"usage,omitempty"`
	NumTurns int             `json:"numTurns,omitempty"`
	Result   string          `json:"result,omitempty"`
	Error    string          `json:"error,omitempty"`
	Raw      json.RawMessage `json:"raw,omitempty"`

	ModelUsage json.RawMessage `json:"modelUsage,omitempty"`
}

// ExtractJSON returns the first balanced {...} block in s.
func ExtractJSON(s string) (json.RawMessage, error) {
	start := strings.IndexByte(s, '{')
	for start >= 0 {
		depth, inStr, esc := 0, false, false
		for i := start; i < len(s); i++ {
			c := s[i]
			switch {
			case esc:
				esc = false
			case inStr && c == '\\':
				esc = true
			case c == '"':
				inStr = !inStr
			case inStr:
			case c == '{':
				depth++
			case c == '}':
				depth--
				if depth == 0 {
					raw := json.RawMessage(s[start : i+1])
					if json.Valid(raw) {
						return raw, nil
					}
					i = len(s)
				}
			}
		}
		next := strings.IndexByte(s[start+1:], '{')
		if next < 0 {
			break
		}
		start += next + 1
	}
	return nil, errors.New("no JSON object in model output")
}
