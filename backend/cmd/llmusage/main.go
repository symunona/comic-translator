// llmusage prints per-stage LLM token and cost totals from data/<id>/llm logs.
//
//	go run ./cmd/llmusage [-data dir] [id-prefix ...]
//
// Without ids it prints every strip.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"comic-translator/backend/internal/llm"
	"comic-translator/backend/internal/store"
)

const defaultData = "/data/dev/comic-translator/data"

func main() {
	dataDir := flag.String("data", defaultData, "data directory")
	flag.Parse()

	st, err := store.NewFS(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	ids, err := resolve(st.Root(), flag.Args())
	if err != nil {
		log.Fatal(err)
	}
	var grand llm.StageUsage
	for _, id := range ids {
		rep, err := llm.ReadUsage(st.Path(id, "llm"))
		if err != nil {
			log.Fatal(err)
		}
		if rep.Total.Calls == 0 {
			continue
		}
		name := id[:8]
		if m, err := st.Meta(id); err == nil {
			name += "  " + m.OrigName
		}
		fmt.Println(name)
		printTable(rep)
		fmt.Println()
		grand.Calls += rep.Total.Calls
		grand.CostUSD += rep.Total.CostUSD
	}
	if len(ids) > 1 {
		fmt.Printf("all strips: %d calls, $%.2f\n", grand.Calls, grand.CostUSD)
	}
}

func resolve(root string, prefixes []string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, e.Name(), "meta.json")); err != nil {
			continue
		}
		if len(prefixes) == 0 || hasPrefix(e.Name(), prefixes) {
			ids = append(ids, e.Name())
		}
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("no strip matches %v", prefixes)
	}
	return ids, nil
}

func hasPrefix(s string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

func printTable(rep *llm.Report) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(w, "stage\tcalls\tturns\tinput\tcache write\tcache read\toutput\tcost $\t$/call\ttime\t")
	for _, s := range append(rep.Stages, rep.Total) {
		fmt.Fprintf(w, "%s\t%s\t%d\t%s\t%s\t%s\t%s\t%.3f\t%.3f\t%s\t\n",
			s.Stage, calls(s), s.Turns,
			tok(s, s.Tokens.InputTokens), tok(s, s.Tokens.CacheCreationTokens),
			tok(s, s.Tokens.CacheReadTokens), tok(s, s.Tokens.OutputTokens),
			s.CostUSD, s.CostUSD/float64(max(s.Calls, 1)),
			(time.Duration(s.DurationMs) * time.Millisecond).Round(time.Second))
	}
	w.Flush()
	if rep.Total.Untracked > 0 {
		fmt.Printf("  * %d calls logged before token capture: cost known, tokens missing\n", rep.Total.Untracked)
	}
}

func calls(s llm.StageUsage) string {
	out := fmt.Sprint(s.Calls)
	if s.Errors > 0 {
		out += fmt.Sprintf(" (%d err)", s.Errors)
	}
	return out
}

func tok(s llm.StageUsage, n int) string {
	if s.Untracked == s.Calls {
		return "-"
	}
	out := fmt.Sprint(n)
	if s.Untracked > 0 {
		out += "*"
	}
	return out
}
