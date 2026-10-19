package llm

import (
	"context"
	"slices"
	"sync"
	"time"
)

// Meter sums usage of every call made with its context, so a caller can
// attribute cost to one result (a translation version) instead of a stage.
type Meter struct {
	mu       sync.Mutex
	calls    int
	tokens   Usage
	cost     float64
	duration time.Duration
	models   []string
}

type MeterTotal struct {
	Calls      int      `json:"calls"`
	Tokens     Usage    `json:"tokens"`
	CostUSD    float64  `json:"costUsd"`
	DurationMs int64    `json:"durationMs"`
	Models     []string `json:"models"`
}

type meterKey struct{}

func WithMeter(ctx context.Context, m *Meter) context.Context {
	return context.WithValue(ctx, meterKey{}, m)
}

func (m *Meter) record(model string, res *Response, d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	m.duration += d
	if !slices.Contains(m.models, model) {
		m.models = append(m.models, model)
	}
	if res != nil {
		m.cost += res.CostUSD
		if res.Usage != nil {
			m.tokens.add(*res.Usage)
		}
	}
}

func (m *Meter) Total() MeterTotal {
	m.mu.Lock()
	defer m.mu.Unlock()
	return MeterTotal{
		Calls: m.calls, Tokens: m.tokens, CostUSD: m.cost,
		DurationMs: m.duration.Milliseconds(), Models: slices.Clone(m.models),
	}
}

// Add folds another total in, for results built over several runs.
func (t *MeterTotal) Add(o MeterTotal) {
	t.Calls += o.Calls
	t.Tokens.add(o.Tokens)
	t.CostUSD += o.CostUSD
	t.DurationMs += o.DurationMs
	for _, m := range o.Models {
		if !slices.Contains(t.Models, m) {
			t.Models = append(t.Models, m)
		}
	}
}

func meterFrom(ctx context.Context) *Meter {
	m, _ := ctx.Value(meterKey{}).(*Meter)
	return m
}
