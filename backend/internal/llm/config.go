package llm

import (
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
)

type preset struct {
	baseURL string
	keyEnv  string
	extra   map[string]any
}

// presets are OpenAI-compatible endpoints. <PROVIDER>_BASE_URL overrides the URL.
var presets = map[string]preset{
	"openrouter":  {"https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", map[string]any{"usage": map[string]bool{"include": true}}},
	"qwen":        {"https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "DASHSCOPE_API_KEY", nil},
	"zai":         {"https://api.z.ai/api/paas/v4", "ZAI_API_KEY", nil},
	"moonshot":    {"https://api.moonshot.ai/v1", "MOONSHOT_API_KEY", nil},
	"deepseek":    {"https://api.deepseek.com", "DEEPSEEK_API_KEY", nil},
	"minimax":     {"https://api.minimax.io/v1", "MINIMAX_API_KEY", nil},
	"stepfun":     {"https://api.stepfun.ai/v1", "STEPFUN_API_KEY", nil},
	"gemini":      {"https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY", nil},
	"openai":      {"https://api.openai.com/v1", "OPENAI_API_KEY", nil},
	"mistral":     {"https://api.mistral.ai/v1", "MISTRAL_API_KEY", nil},
	"siliconflow": {"https://api.siliconflow.com/v1", "SILICONFLOW_API_KEY", nil},
	"ollama":      {"http://127.0.0.1:11434/v1", "", nil},
}

// Stages a Router can route separately; env LLM_<STAGE> overrides LLM.
var Stages = []string{"ocr", "scene", "translate", "review"}

type Options struct {
	ClaudeBin   string
	DefaultSpec string
	DataDir     string
	TmpDir      string
	Concurrency int
}

// FromEnv builds the LLM from env:
//
//	LLM=<provider>:<model>[?effort=low&json=1]   default for every stage
//	LLM_OCR / LLM_SCENE / LLM_TRANSLATE / LLM_REVIEW   per-stage override
//
// Providers: claude-cli, anthropic, and the OpenAI-compatible presets.
func FromEnv(o Options) (*Router, error) {
	sem := make(chan struct{}, max(o.Concurrency, 1))
	built := map[string]*Client{}
	get := func(spec string) (*Client, error) {
		if c, ok := built[spec]; ok {
			return c, nil
		}
		b, err := NewBackend(spec, o)
		if err != nil {
			return nil, err
		}
		c := NewClient(b, sem)
		built[spec] = c
		return c, nil
	}
	spec := os.Getenv("LLM")
	if spec == "" {
		spec = o.DefaultSpec
	}
	def, err := get(spec)
	if err != nil {
		return nil, fmt.Errorf("LLM=%q: %w", spec, err)
	}
	r := &Router{Default: def, Routes: map[string]*Client{}}
	for _, st := range Stages {
		env := "LLM_" + strings.ToUpper(st)
		if s := os.Getenv(env); s != "" {
			c, err := get(s)
			if err != nil {
				return nil, fmt.Errorf("%s=%q: %w", env, s, err)
			}
			r.Routes[st] = c
		}
	}
	return r, nil
}

// NewBackend parses "<provider>:<model>[?effort=..&json=1]".
func NewBackend(spec string, o Options) (Backend, error) {
	provider, rest, ok := strings.Cut(spec, ":")
	if !ok || rest == "" {
		return nil, fmt.Errorf("want <provider>:<model>, got %q", spec)
	}
	model, rawQuery, _ := strings.Cut(rest, "?")
	q, err := url.ParseQuery(rawQuery)
	if err != nil {
		return nil, err
	}
	effort := q.Get("effort")
	switch provider {
	case "claude-cli":
		return NewClaudeCLI(o.ClaudeBin, model, o.DataDir, o.TmpDir), nil
	case "anthropic":
		key := os.Getenv("ANTHROPIC_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("ANTHROPIC_API_KEY not set")
		}
		return NewAnthropic(key, os.Getenv("ANTHROPIC_BASE_URL"), model, effort), nil
	}
	p, ok := presets[provider]
	if !ok {
		return nil, fmt.Errorf("unknown provider %q (have claude-cli, anthropic, %s)", provider, strings.Join(presetNames(), ", "))
	}
	base := p.baseURL
	if v := os.Getenv(strings.ToUpper(provider) + "_BASE_URL"); v != "" {
		base = v
	}
	var key string
	if p.keyEnv != "" {
		if key = os.Getenv(p.keyEnv); key == "" {
			return nil, fmt.Errorf("%s not set", p.keyEnv)
		}
	}
	return &OpenAI{Provider: provider, BaseURL: base, APIKey: key, Model: model, Effort: effort, JSONMode: q.Get("json") == "1", Extra: p.extra}, nil
}

func presetNames() []string {
	names := make([]string, 0, len(presets))
	for k := range presets {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}
