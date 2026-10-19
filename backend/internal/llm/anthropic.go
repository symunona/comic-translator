package llm

import (
	"context"
	"errors"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// Anthropic calls the Messages API directly: images inline, one turn.
type Anthropic struct {
	client    anthropic.Client
	Model     string
	Effort    string
	MaxTokens int64
}

func NewAnthropic(apiKey, baseURL, model, effort string) *Anthropic {
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	return &Anthropic{client: anthropic.NewClient(opts...), Model: model, Effort: effort, MaxTokens: 64000}
}

func (a *Anthropic) Name() string { return "anthropic:" + a.Model }

func (a *Anthropic) Complete(ctx context.Context, req Request) (*Response, error) {
	images, err := encodeImages(req.Images)
	if err != nil {
		return nil, err
	}
	blocks := make([]anthropic.ContentBlockParamUnion, 0, len(images)+1)
	for _, img := range images {
		blocks = append(blocks, anthropic.NewImageBlockBase64(img.mime, img.b64))
	}
	blocks = append(blocks, anthropic.NewTextBlock(req.Prompt))
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(a.Model),
		MaxTokens: a.MaxTokens,
		System:    []anthropic.TextBlockParam{{Text: req.System}},
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(blocks...)},
	}
	if a.Effort != "" {
		params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffort(a.Effort)}
	}
	stream := a.client.Messages.NewStreaming(ctx, params,
		option.WithHeaderAdd("anthropic-beta", "server-side-fallback-2026-07-01"),
		option.WithJSONSet("fallbacks", "default"))
	msg := anthropic.Message{}
	for stream.Next() {
		msg.Accumulate(stream.Current())
	}
	if err := stream.Err(); err != nil {
		return nil, err
	}
	var text string
	for _, b := range msg.Content {
		if t, ok := b.AsAny().(anthropic.TextBlock); ok {
			text += t.Text
		}
	}
	u := Usage{
		InputTokens:         int(msg.Usage.InputTokens),
		CacheCreationTokens: int(msg.Usage.CacheCreationInputTokens),
		CacheReadTokens:     int(msg.Usage.CacheReadInputTokens),
		OutputTokens:        int(msg.Usage.OutputTokens),
	}
	res := &Response{Text: text, Usage: &u, CostUSD: priceFor(a.Name()).cost(u), Turns: 1}
	switch msg.StopReason {
	case anthropic.StopReasonRefusal:
		return res, errors.New("model refused: " + string(msg.StopDetails.Category))
	case anthropic.StopReasonMaxTokens:
		return res, errors.New("hit max_tokens")
	}
	return res, nil
}
