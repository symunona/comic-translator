package llm

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Usage struct {
	InputTokens         int `json:"input_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens"`
	CacheReadTokens     int `json:"cache_read_input_tokens"`
	OutputTokens        int `json:"output_tokens"`
	ReasoningTokens     int `json:"reasoning_tokens,omitempty"`
}

func (u *Usage) add(o Usage) {
	u.InputTokens += o.InputTokens
	u.CacheCreationTokens += o.CacheCreationTokens
	u.CacheReadTokens += o.CacheReadTokens
	u.OutputTokens += o.OutputTokens
	u.ReasoningTokens += o.ReasoningTokens
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
	Paid       int      `json:"paid"`
	Credits    int      `json:"credits"`
}

// Call is one logged LLM call. Name is the log file without .json.
type Call struct {
	Name       string    `json:"name"`
	Stage      string    `json:"stage"`
	Label      string    `json:"label"`
	Backend    string    `json:"backend"`
	Model      string    `json:"model"`
	Attempt    int       `json:"attempt"`
	Error      string    `json:"error,omitempty"`
	Local      bool      `json:"local"`
	Tokens     *Usage    `json:"tokens,omitempty"`
	Turns      int       `json:"turns,omitempty"`
	CostUSD    float64   `json:"costUsd"`
	Credits    int       `json:"credits"`
	DurationMs int64     `json:"durationMs"`
	Time       time.Time `json:"time"`
}

type Report struct {
	Stages []StageUsage `json:"stages"`
	Total  StageUsage   `json:"total"`
	Calls  []Call       `json:"calls"`
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
		return &Report{Stages: []StageUsage{}, Total: StageUsage{Stage: "total", Models: []string{}}, Calls: []Call{}}, nil
	}
	if err != nil {
		return nil, err
	}
	byStage := map[string]*StageUsage{}
	models := map[string]map[string]bool{}
	calls := []Call{}
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
		call := newCall(strings.TrimSuffix(e.Name(), ".json"), m[1], name, l)
		calls = append(calls, call)
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
		s.Credits += call.Credits
		if call.Credits > 0 {
			s.Paid++
		}
		s.DurationMs += call.DurationMs
		models[name][call.Backend+":"+call.Model] = true
	}
	sort.SliceStable(calls, func(i, j int) bool {
		a, b := calls[i], calls[j]
		if ka, kb := stageKey(a.Stage), stageKey(b.Stage); ka != kb {
			return ka < kb
		}
		if a.Stage != b.Stage {
			return a.Stage < b.Stage
		}
		return naturalLess(a.Name, b.Name)
	})
	rep := &Report{Total: StageUsage{Stage: "total"}, Calls: calls}
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
		t.Credits += s.Credits
		t.Paid += s.Paid
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

func newCall(file, logName, stage string, l logEntry) Call {
	backend, model := l.Backend, l.Model
	if b, m, ok := strings.Cut(model, ":"); ok && (backend == "" || backend == b) {
		backend, model = b, m
	}
	if backend == "" {
		backend = "claude-cli"
	}
	c := Call{
		Name: file, Stage: stage, Label: callLabel(logName, stage), Backend: backend, Model: model,
		Attempt: l.Attempt, Error: l.Error, Local: IsLocal(backend), Tokens: l.Usage, Turns: l.NumTurns,
		CostUSD: l.CostUSD, Time: l.Time,
	}
	if !c.Local {
		c.Credits = Credits(l.CostUSD)
	}
	if d, err := time.ParseDuration(l.Duration); err == nil {
		c.DurationMs = d.Milliseconds()
	}
	return c
}

func callLabel(logName, stage string) string {
	if stage == "ocr" {
		return strings.TrimPrefix(logName, "ocr-")
	}
	base, _, _ := strings.Cut(stage, ":")
	return base
}

var digits = regexp.MustCompile(`\d+|\D+`)

// naturalLess orders ocr-p2-0 before ocr-p10-0.
func naturalLess(a, b string) bool {
	pa, pb := digits.FindAllString(a, -1), digits.FindAllString(b, -1)
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] == pb[i] {
			continue
		}
		na, ea := strconv.Atoi(pa[i])
		nb, eb := strconv.Atoi(pb[i])
		if ea == nil && eb == nil {
			return na < nb
		}
		return pa[i] < pb[i]
	}
	return len(pa) < len(pb)
}
