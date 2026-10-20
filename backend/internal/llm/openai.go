package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAI speaks the chat-completions dialect most providers share: OpenRouter,
// Qwen (DashScope), GLM (Z.ai), Kimi (Moonshot), DeepSeek, Gemini, ollama.
type OpenAI struct {
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
	Effort   string
	JSONMode bool
	// MaxTokens caps the reply incl. reasoning; 0 leaves the provider default.
	MaxTokens int
	Extra     map[string]any
	HTTP      *http.Client
}

func (o *OpenAI) Name() string { return o.Provider + ":" + o.Model }

type oaPart struct {
	Type     string      `json:"type"`
	Text     string      `json:"text,omitempty"`
	ImageURL *oaImageURL `json:"image_url,omitempty"`
}

type oaImageURL struct {
	URL string `json:"url"`
}

type oaMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type oaResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens         int      `json:"prompt_tokens"`
		CompletionTokens     int      `json:"completion_tokens"`
		PromptCacheHitTokens int      `json:"prompt_cache_hit_tokens"`
		Cost                 *float64 `json:"cost"`
		PromptDetails        *struct {
			CachedTokens int `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
		CompletionDetails *struct {
			ReasoningTokens int `json:"reasoning_tokens"`
		} `json:"completion_tokens_details"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (o *OpenAI) Complete(ctx context.Context, req Request) (*Response, error) {
	images, err := encodeImages(req.Images)
	if err != nil {
		return nil, err
	}
	parts := make([]oaPart, 0, len(images)+1)
	for _, img := range images {
		parts = append(parts, oaPart{Type: "image_url", ImageURL: &oaImageURL{URL: "data:" + img.mime + ";base64," + img.b64}})
	}
	parts = append(parts, oaPart{Type: "text", Text: req.Prompt})
	body := map[string]any{
		"model":    o.Model,
		"messages": []oaMessage{{Role: "system", Content: req.System}, {Role: "user", Content: parts}},
	}
	if o.Effort != "" {
		body["reasoning_effort"] = o.Effort
	}
	if o.MaxTokens > 0 {
		body["max_tokens"] = o.MaxTokens
	}
	if o.JSONMode {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	for k, v := range o.Extra {
		body[k] = v
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(o.BaseURL, "/")+"/chat/completions", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if o.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+o.APIKey)
	}
	client := o.HTTP
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Minute}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var out oaResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return &Response{Text: string(raw)}, fmt.Errorf("http %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}
	if out.Error != nil || resp.StatusCode != http.StatusOK {
		msg := truncate(string(raw), 300)
		if out.Error != nil {
			msg = out.Error.Message
		}
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, msg)
	}
	if len(out.Choices) == 0 {
		return nil, errors.New("no choices in response")
	}
	res := &Response{Text: out.Choices[0].Message.Content, Turns: 1}
	if u := out.Usage; u != nil {
		cached := u.PromptCacheHitTokens
		if u.PromptDetails != nil && u.PromptDetails.CachedTokens > cached {
			cached = u.PromptDetails.CachedTokens
		}
		usage := Usage{InputTokens: u.PromptTokens - cached, CacheReadTokens: cached, OutputTokens: u.CompletionTokens}
		if u.CompletionDetails != nil {
			usage.ReasoningTokens = u.CompletionDetails.ReasoningTokens
		}
		res.Usage = &usage
		if u.Cost != nil {
			res.CostUSD = *u.Cost
		} else {
			res.CostUSD = priceFor(o.Name()).cost(usage)
		}
	}
	if out.Choices[0].FinishReason == "length" {
		return res, errors.New("hit max tokens")
	}
	if strings.TrimSpace(res.Text) == "" {
		return res, fmt.Errorf("empty reply (finish_reason %q)", out.Choices[0].FinishReason)
	}
	return res, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
