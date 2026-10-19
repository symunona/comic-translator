package llm

import (
	"encoding/json"
	"os"
	"strings"
)

// Price is USD per million tokens.
type Price struct {
	In         float64 `json:"in"`
	Out        float64 `json:"out"`
	CacheRead  float64 `json:"cacheRead"`
	CacheWrite float64 `json:"cacheWrite"`
}

func (p Price) cost(u Usage) float64 {
	return (float64(u.InputTokens)*p.In + float64(u.OutputTokens)*p.Out +
		float64(u.CacheReadTokens)*p.CacheRead + float64(u.CacheCreationTokens)*p.CacheWrite) / 1e6
}

// prices is keyed by model id without provider prefix. List prices, checked
// 2026-10-19; LLM_PRICES='{"model":{"in":1,"out":2}}' overrides or adds.
var prices = map[string]Price{
	"claude-opus-5-5":   {In: 4, Out: 20, CacheRead: 0.2, CacheWrite: 5},
	"claude-sonnet-5-5": {In: 2, Out: 10, CacheRead: 0.2, CacheWrite: 2.5},
	"claude-haiku-5-5":  {In: 0.1, Out: 0.5, CacheRead: 0.01, CacheWrite: 0.125},

	"gemini-3.8-flash":      {In: 0.75, Out: 3.75, CacheRead: 0.075},
	"gemini-3.5-flash-lite": {In: 0.3, Out: 2.5, CacheRead: 0.03},
	"gemini-3.1-flash-lite": {In: 0.25, Out: 1.5, CacheRead: 0.025},
	"gemini-2.5-flash":      {In: 0.3, Out: 2.5, CacheRead: 0.03},
	"gemini-2.5-flash-lite": {In: 0.1, Out: 0.4, CacheRead: 0.01},

	"qwen3.8-max":   {In: 2, Out: 6},
	"qwen3.7-plus":  {In: 0.4, Out: 1.6},
	"qwen3.8-flash": {In: 0.15, Out: 0.47, CacheRead: 0.016},
	"qwen3-vl-plus": {In: 0.2, Out: 1.6},

	"glm-5.3-flash":  {In: 0.15, Out: 0.5, CacheRead: 0.03},
	"glm-5.3-flashx": {In: 0.37, Out: 1.25, CacheRead: 0.075},
	"glm-4.6v":       {In: 0.3, Out: 0.9, CacheRead: 0.05},
	"glm-4.6v-flash": {},
	"glm-5v-turbo":   {In: 1.2, Out: 4, CacheRead: 0.24},

	"kimi-k3":   {In: 3, Out: 15, CacheRead: 0.3},
	"kimi-k2.6": {In: 0.95, Out: 4, CacheRead: 0.16},

	"deepseek-flash": {In: 0.3, Out: 1.2, CacheRead: 0.006},

	"MiniMax-M3":         {In: 0.3, Out: 1.2, CacheRead: 0.06},
	"MiniMax-M3.1-Flash": {In: 0.15, Out: 0.6, CacheRead: 0.015},
	"step-3.7-flash":     {In: 0.2, Out: 1.15, CacheRead: 0.04},
	"gpt-5.6-luna":       {In: 0.2, Out: 1.2, CacheRead: 0.02},
	"gpt-5-mini":         {In: 0.25, Out: 2, CacheRead: 0.025},
	"mistral-large-4-0":  {In: 0.68, Out: 2.09, CacheRead: 0.07},
}

func init() {
	var extra map[string]Price
	if json.Unmarshal([]byte(os.Getenv("LLM_PRICES")), &extra) == nil {
		for k, v := range extra {
			prices[k] = v
		}
	}
}

// priceFor finds the price of a "provider:model" name, also trying the part
// after an aggregator's "vendor/" prefix. Unknown models cost 0.
func priceFor(name string) Price {
	_, model, _ := strings.Cut(name, ":")
	if p, ok := prices[model]; ok {
		return p
	}
	if i := strings.LastIndexByte(model, '/'); i >= 0 {
		return prices[model[i+1:]]
	}
	return Price{}
}
