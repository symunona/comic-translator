package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const maxArgPrompt = 120_000

type ClaudeCLI struct {
	Bin     string
	Model   string
	Dir     string
	TmpDir  string
	Timeout time.Duration
	sem     chan struct{}
}

func NewClaudeCLI(bin, model, dir, tmpDir string, concurrency int) *ClaudeCLI {
	return &ClaudeCLI{
		Bin: bin, Model: model, Dir: dir, TmpDir: tmpDir,
		Timeout: 15 * time.Minute,
		sem:     make(chan struct{}, concurrency),
	}
}

type cliResult struct {
	Result  string  `json:"result"`
	IsError bool    `json:"is_error"`
	Subtype string  `json:"subtype"`
	CostUSD float64 `json:"total_cost_usd"`
}

func (c *ClaudeCLI) Call(ctx context.Context, prompt string, images []string, schemaHint string) (json.RawMessage, error) {
	full := buildPrompt(prompt, images, schemaHint)
	out, err := c.run(ctx, full, images, 0)
	if err != nil {
		return nil, err
	}
	raw, err := ExtractJSON(out)
	if err == nil {
		return raw, nil
	}
	retry := full + "\n\nYour previous reply was not valid JSON. Return ONLY valid JSON, no prose, no code fences."
	out, err = c.run(ctx, retry, images, 1)
	if err != nil {
		return nil, err
	}
	return ExtractJSON(out)
}

func buildPrompt(prompt string, images []string, schemaHint string) string {
	var b strings.Builder
	if len(images) > 0 {
		b.WriteString("Read these images with the Read tool before answering (in this order):\n")
		for i, p := range images {
			fmt.Fprintf(&b, "%d. %s\n", i+1, p)
		}
		b.WriteString("\n")
	}
	b.WriteString(prompt)
	if schemaHint != "" {
		b.WriteString("\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n")
		b.WriteString(schemaHint)
	}
	return b.String()
}

func (c *ClaudeCLI) run(ctx context.Context, prompt string, images []string, attempt int) (string, error) {
	select {
	case c.sem <- struct{}{}:
	case <-ctx.Done():
		return "", ctx.Err()
	}
	defer func() { <-c.sem }()

	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	args := []string{"-p"}
	var stdin *strings.Reader
	if len(prompt) <= maxArgPrompt {
		args = append(args, prompt)
	} else {
		stdin = strings.NewReader(prompt)
	}
	args = append(args, "--allowedTools", "Read", "--model", c.Model,
		"--output-format", "json", "--no-session-persistence")

	cmd := exec.CommandContext(ctx, c.Bin, args...)
	cmd.Dir = c.Dir
	cmd.Env = append(os.Environ(), "TMPDIR="+c.TmpDir)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr

	start := time.Now()
	runErr := cmd.Run()
	entry := logEntry{
		Time: start, Model: c.Model, Attempt: attempt, Prompt: prompt, Images: images,
		Duration: time.Since(start).Round(time.Millisecond).String(),
	}
	defer func() { writeLog(ctx, entry) }()

	if runErr != nil {
		entry.Error = fmt.Sprintf("%v: %s", runErr, strings.TrimSpace(stderr.String()))
		entry.Raw = rawOrNil(stdout.Bytes())
		return "", fmt.Errorf("claude cli: %s", entry.Error)
	}
	var res cliResult
	if err := json.Unmarshal(stdout.Bytes(), &res); err != nil {
		entry.Error = "decode cli output: " + err.Error()
		entry.Result = stdout.String()
		return "", fmt.Errorf("claude cli: %s", entry.Error)
	}
	entry.Result, entry.CostUSD = res.Result, res.CostUSD
	if res.IsError {
		entry.Error = "cli reported error: " + res.Subtype
		return "", fmt.Errorf("claude cli: %s: %s", res.Subtype, res.Result)
	}
	return res.Result, nil
}

func rawOrNil(b []byte) json.RawMessage {
	if json.Valid(b) {
		return b
	}
	return nil
}
