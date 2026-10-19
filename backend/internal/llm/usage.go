package llm

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Usage struct {
	InputTokens         int `json:"input_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens"`
	CacheReadTokens     int `json:"cache_read_input_tokens"`
	OutputTokens        int `json:"output_tokens"`
}

func (u *Usage) add(o Usage) {
	u.InputTokens += o.InputTokens
	u.CacheCreationTokens += o.CacheCreationTokens
	u.CacheReadTokens += o.CacheReadTokens
	u.OutputTokens += o.OutputTokens
}

// StageUsage sums every logged call of one stage. Untracked counts calls
// logged before token capture existed: their cost is known, tokens are not.
type StageUsage struct {
	Stage      string   `json:"stage"`
	Calls      int      `json:"calls"`
	Errors     int      `json:"errors"`
	Untracked  int      `json:"untracked"`
	Turns      int      `json:"turns"`
	Tokens     Usage    `json:"tokens"`
	CostUSD    float64  `json:"costUsd"`
	DurationMs int64    `json:"durationMs"`
	Models     []string `json:"models"`
}

type Report struct {
	Stages []StageUsage `json:"stages"`
	Total  StageUsage   `json:"total"`
}

var (
	logName  = regexp.MustCompile(`^(.+)-\d+\.json$`)
	panelLog = regexp.MustCompile(`^ocr-p\d+$`)
	langLog  = regexp.MustCompile(`^(translate|review|retranslate)-(.+)$`)
)

var stageOrder = map[string]int{"ocr": 0, "scene": 1, "translate": 2, "review": 3, "retranslate": 4}

// StageOf maps a log name (ocr-p3, translate-en) to its pipeline stage
// (ocr, translate:en).
func StageOf(name string) string {
	if panelLog.MatchString(name) {
		return "ocr"
	}
	if m := langLog.FindStringSubmatch(name); m != nil {
		return m[1] + ":" + m[2]
	}
	return name
}

// ReadUsage aggregates the call logs WithLog wrote into dir.
func ReadUsage(dir string) (*Report, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return &Report{Stages: []StageUsage{}, Total: StageUsage{Stage: "total", Models: []string{}}}, nil
	}
	if err != nil {
		return nil, err
	}
	byStage := map[string]*StageUsage{}
	models := map[string]map[string]bool{}
	for _, e := range entries {
		m := logName.FindStringSubmatch(e.Name())
		if e.IsDir() || m == nil {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var l logEntry
		if json.Unmarshal(data, &l) != nil {
			continue
		}
		name := StageOf(m[1])
		s, ok := byStage[name]
		if !ok {
			s = &StageUsage{Stage: name}
			byStage[name] = s
			models[name] = map[string]bool{}
		}
		s.Calls++
		if l.Error != "" {
			s.Errors++
		}
		if l.Usage != nil {
			s.Tokens.add(*l.Usage)
		} else {
			s.Untracked++
		}
		s.Turns += l.NumTurns
		s.CostUSD += l.CostUSD
		if d, err := time.ParseDuration(l.Duration); err == nil {
			s.DurationMs += d.Milliseconds()
		}
		if l.Model != "" {
			models[name][l.Model] = true
		}
	}
	rep := &Report{Total: StageUsage{Stage: "total"}}
	all := map[string]bool{}
	for name, s := range byStage {
		s.Models = sortedKeys(models[name])
		for k := range models[name] {
			all[k] = true
		}
		rep.Stages = append(rep.Stages, *s)
		t := &rep.Total
		t.Calls += s.Calls
		t.Errors += s.Errors
		t.Untracked += s.Untracked
		t.Turns += s.Turns
		t.Tokens.add(s.Tokens)
		t.CostUSD += s.CostUSD
		t.DurationMs += s.DurationMs
	}
	rep.Total.Models = sortedKeys(all)
	sort.Slice(rep.Stages, func(i, j int) bool {
		a, b := rep.Stages[i].Stage, rep.Stages[j].Stage
		ka, kb := stageKey(a), stageKey(b)
		if ka != kb {
			return ka < kb
		}
		return a < b
	})
	if rep.Stages == nil {
		rep.Stages = []StageUsage{}
	}
	return rep, nil
}

func stageKey(stage string) int {
	base, _, _ := strings.Cut(stage, ":")
	if k, ok := stageOrder[base]; ok {
		return k
	}
	return len(stageOrder)
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
