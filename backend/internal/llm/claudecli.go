package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const maxArgPrompt = 120_000

// ClaudeCLI runs `claude -p` on a Claude subscription. Images are read by the
// model through the Read tool, one turn per image.
type ClaudeCLI struct {
	Bin     string
	Model   string
	Dir     string
	TmpDir  string
	Timeout time.Duration
	Lean    bool
}

func NewClaudeCLI(bin, model, dir, tmpDir string) *ClaudeCLI {
	return &ClaudeCLI{Bin: bin, Model: model, Dir: dir, TmpDir: tmpDir, Timeout: 15 * time.Minute, Lean: true}
}

func (c *ClaudeCLI) Name() string { return "claude-cli:" + c.Model }

type cliResult struct {
	Result     string          `json:"result"`
	IsError    bool            `json:"is_error"`
	Subtype    string          `json:"subtype"`
	CostUSD    float64         `json:"total_cost_usd"`
	NumTurns   int             `json:"num_turns"`
	Usage      *Usage          `json:"usage"`
	ModelUsage json.RawMessage `json:"modelUsage"`
}

func cliPrompt(req Request) string {
	if len(req.Images) == 0 {
		return req.Prompt
	}
	var b strings.Builder
	b.WriteString("Read these images with the Read tool before answering (in this order):\n")
	for i, p := range req.Images {
		fmt.Fprintf(&b, "%d. %s\n", i+1, p)
	}
	b.WriteString("\n")
	b.WriteString(req.Prompt)
	return b.String()
}

func (c *ClaudeCLI) Complete(ctx context.Context, req Request) (*Response, error) {
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	prompt := cliPrompt(req)
	args := []string{"-p"}
	var stdin *strings.Reader
	if len(prompt) <= maxArgPrompt {
		args = append(args, prompt)
	} else {
		stdin = strings.NewReader(prompt)
	}
	args = append(args, "--allowedTools", "Read", "--model", c.Model,
		"--output-format", "json", "--no-session-persistence")
	if c.Lean {
		// Strip the Claude Code harness down to the Read tool: no default system
		// prompt, settings, CLAUDE.md, MCP or skills. ~12k fewer tokens per call.
		args = append(args, "--tools", "Read", "--system-prompt", req.System,
			"--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands")
	}

	cmd := exec.CommandContext(ctx, c.Bin, args...)
	cmd.Dir = c.Dir
	cmd.Env = append(os.Environ(), "TMPDIR="+c.TmpDir)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr

	if err := cmd.Run(); err != nil {
		return &Response{Text: stdout.String()}, fmt.Errorf("%v: %s", err, strings.TrimSpace(stderr.String()))
	}
	var res cliResult
	if err := json.Unmarshal(stdout.Bytes(), &res); err != nil {
		return &Response{Text: stdout.String()}, errors.New("decode cli output: " + err.Error())
	}
	out := &Response{Text: res.Result, Usage: res.Usage, CostUSD: res.CostUSD, Turns: res.NumTurns, ModelUsage: res.ModelUsage}
	if res.IsError {
		return out, fmt.Errorf("cli reported error: %s", res.Subtype)
	}
	return out, nil
}
