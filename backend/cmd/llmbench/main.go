// llmbench replays logged LLM calls on several backends and saves every
// answer, for offline scoring. Resumable: answers already on disk are skipped.
// Stops before a call when the run's spend reaches -max-usd.
//
//	go run ./cmd/llmbench -out ../bench/llm -spec openrouter:qwen/qwen3.8-flash -spec claude-cli:haiku data/<id>/llm/ocr-p*-0.json
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"comic-translator/backend/internal/llm"
)

type specs []string

func (s *specs) String() string     { return strings.Join(*s, ",") }
func (s *specs) Set(v string) error { *s = append(*s, v); return nil }

type logged struct {
	Prompt string   `json:"prompt"`
	Images []string `json:"images"`
}

// Answer is one replayed call, written to <out>/<spec>/<strip>/<log>.json.
type Answer struct {
	Spec    string          `json:"spec"`
	Log     string          `json:"log"`
	Text    string          `json:"text"`
	JSON    json.RawMessage `json:"json,omitempty"`
	Usage   *llm.Usage      `json:"usage,omitempty"`
	CostUSD float64         `json:"costUsd"`
	Ms      int64           `json:"ms"`
	Error   string          `json:"error,omitempty"`
	At      time.Time       `json:"at"`
}

var slugRe = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func slug(s string) string { return strings.Trim(slugRe.ReplaceAllString(s, "_"), "_") }

func main() {
	var ss specs
	flag.Var(&ss, "spec", "backend <provider>:<model>[?..], repeatable")
	out := flag.String("out", "bench/llm", "answers directory")
	maxUSD := flag.Float64("max-usd", 0.5, "stop starting new calls once this run spent this much")
	par := flag.Int("par", 4, "concurrent calls per spec")
	dataDir := flag.String("data", "../data", "strip data root (claude-cli working dir)")
	flag.Parse()
	if len(ss) == 0 || flag.NArg() == 0 {
		flag.Usage()
		os.Exit(2)
	}
	tmp := os.Getenv("TMPDIR")
	var mu sync.Mutex
	spent := 0.0
	var wg sync.WaitGroup
	for _, spec := range ss {
		b, err := llm.NewBackend(spec, llm.Options{ClaudeBin: "claude", TmpDir: tmp, DataDir: *dataDir})
		if err != nil {
			log.Fatalf("%s: %v", spec, err)
		}
		sem := make(chan struct{}, *par)
		for _, path := range flag.Args() {
			strip := filepath.Base(filepath.Dir(filepath.Dir(path)))
			dst := filepath.Join(*out, slug(spec), strip[:min(8, len(strip))], strings.TrimSuffix(filepath.Base(path), ".json")+".json")
			if _, err := os.Stat(dst); err == nil {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				mu.Lock()
				over := spent >= *maxUSD
				mu.Unlock()
				if over {
					log.Printf("skip %s %s: budget %.2f reached", spec, path, *maxUSD)
					return
				}
				a := run(b, spec, path)
				mu.Lock()
				spent += a.CostUSD
				total := spent
				mu.Unlock()
				status := "ok"
				if a.Error != "" {
					status = a.Error
				}
				log.Printf("%-48s %-28s %6dms $%.4f (run $%.3f) %s", spec, filepath.Base(path), a.Ms, a.CostUSD, total, trim(status, 80))
				if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
					log.Fatal(err)
				}
				data, _ := json.MarshalIndent(a, "", "  ")
				if err := os.WriteFile(dst, data, 0o644); err != nil {
					log.Fatal(err)
				}
			}()
		}
	}
	wg.Wait()
	fmt.Printf("spent $%.4f\n", spent)
}

func run(b llm.Backend, spec, path string) Answer {
	a := Answer{Spec: spec, Log: path, At: time.Now().UTC()}
	data, err := os.ReadFile(path)
	if err != nil {
		a.Error = err.Error()
		return a
	}
	var l logged
	if err := json.Unmarshal(data, &l); err != nil {
		a.Error = err.Error()
		return a
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	start := time.Now()
	res, err := b.Complete(ctx, llm.Request{
		System: "You read comic images and answer with exactly one JSON object, no prose, no code fences.",
		Prompt: stripReadHeader(l.Prompt), Images: l.Images,
	})
	a.Ms = time.Since(start).Milliseconds()
	if res != nil {
		a.Text, a.Usage, a.CostUSD = res.Text, res.Usage, res.CostUSD
		if raw, jerr := llm.ExtractJSON(res.Text); jerr == nil {
			a.JSON = raw
		} else if err == nil {
			err = jerr
		}
	}
	if err != nil {
		a.Error = err.Error()
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		a.Error = "timeout"
	}
	return a
}

func trim(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// stripReadHeader drops the claude-cli "Read these images with the Read tool"
// preamble from prompts logged by that backend.
func stripReadHeader(p string) string {
	if !strings.HasPrefix(p, "Read these images") {
		return p
	}
	if _, rest, ok := strings.Cut(p, "\n\n"); ok {
		return rest
	}
	return p
}
