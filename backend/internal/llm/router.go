package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Router sends each pipeline stage (from WithStage) to its own Client.
type Router struct {
	Default *Client
	Routes  map[string]*Client
}

func (r *Router) Call(ctx context.Context, prompt string, images []string, schemaHint string) (json.RawMessage, error) {
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

// Specs maps each routable stage to the backend name it calls.
func (r *Router) Specs() map[string]string {
	out := map[string]string{}
	for _, st := range Stages {
		c, ok := r.Routes[st]
		if !ok {
			c = r.Default
		}
		out[st] = c.Backend.Name()
	}
	return out
}
