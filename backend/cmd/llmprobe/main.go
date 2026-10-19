// llmprobe replays logged LLM calls against another backend to compare
// providers on real prompts.
//
//	go run ./cmd/llmprobe -spec qwen:qwen3-vl-plus data/<id>/llm/ocr-p3-0.json ...
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"comic-translator/backend/internal/llm"
)

type logged struct {
	Prompt string   `json:"prompt"`
	Images []string `json:"images"`
	Result string   `json:"result"`
}

func main() {
	spec := flag.String("spec", "", "backend <provider>:<model>[?effort=..&json=1]")
	showOld := flag.Bool("old", false, "also print the logged result")
	flag.Parse()
	if *spec == "" || flag.NArg() == 0 {
		flag.Usage()
		os.Exit(2)
	}
	b, err := llm.NewBackend(*spec, llm.Options{ClaudeBin: "claude", TmpDir: os.TempDir()})
	if err != nil {
		log.Fatal(err)
	}
	var total float64
	for _, path := range flag.Args() {
		data, err := os.ReadFile(path)
		if err != nil {
			log.Fatal(err)
		}
		var l logged
		if err := json.Unmarshal(data, &l); err != nil {
			log.Fatalf("%s: %v", path, err)
		}
		start := time.Now()
		res, err := b.Complete(context.Background(), llm.Request{
			System: "You read comic images and answer with exactly one JSON object, no prose, no code fences.",
			Prompt: stripReadHeader(l.Prompt), Images: l.Images,
		})
		fmt.Printf("== %s  %s  %s\n", path, b.Name(), time.Since(start).Round(time.Millisecond))
		if err != nil {
			fmt.Println("error:", err)
		}
		if res == nil {
			continue
		}
		if res.Usage != nil {
			u := res.Usage
			fmt.Printf("tokens in %d cached %d out %d (reasoning %d)  $%.4f\n", u.InputTokens, u.CacheReadTokens, u.OutputTokens, u.ReasoningTokens, res.CostUSD)
		}
		total += res.CostUSD
		if _, err := llm.ExtractJSON(res.Text); err != nil {
			fmt.Println("invalid JSON:", err)
		}
		fmt.Println(res.Text)
		if *showOld {
			fmt.Println("-- logged:")
			fmt.Println(l.Result)
		}
	}
	fmt.Printf("total $%.4f\n", total)
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
