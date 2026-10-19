package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// Router sends each pipeline stage (from WithStage) to its own Client, or
// every stage to the backend named by WithSpec.
type Router struct {
	Default *Client
	Routes  map[string]*Client

	opts  Options
	sem   chan struct{}
	mu    sync.Mutex
	built map[string]*Client
}

type specKey struct{}

// WithSpec overrides routing for calls made with ctx: every stage goes to the
// backend "<provider>:<model>[?..]". The Router must have built it (Client).
func WithSpec(ctx context.Context, spec string) context.Context {
	return context.WithValue(ctx, specKey{}, spec)
}

// Client returns the cached Client for spec, building it on first use. All
// Clients share the Router's concurrency cap.
func (r *Router) Client(spec string) (*Client, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.built[spec]; ok {
		return c, nil
	}
	b, err := NewBackend(spec, r.opts)
	if err != nil {
		return nil, err
	}
	c := NewClient(b, r.sem)
	r.built[spec] = c
	return c, nil
}

func (r *Router) Call(ctx context.Context, prompt string, images []string, schemaHint string) (json.RawMessage, error) {
	if spec, ok := ctx.Value(specKey{}).(string); ok {
		c, err := r.Client(spec)
		if err != nil {
			return nil, err
		}
		return c.Call(ctx, prompt, images, schemaHint)
	}
	c, ok := r.Routes[stageFrom(ctx)]
	if !ok {
		c = r.Default
	}
	return c.Call(ctx, prompt, images, schemaHint)
}

func (r *Router) String() string {
	parts := []string{r.Default.Backend.Name()}
	for _, st := range Stages {
		if c, ok := r.Routes[st]; ok {
			parts = append(parts, fmt.Sprintf("%s=%s", st, c.Backend.Name()))
		}
	}
	return strings.Join(parts, " ")
}
