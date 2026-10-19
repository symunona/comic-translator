package llm

import "testing"

func TestExtractWithKey(t *testing.T) {
	broken := `{"regions":[{"n":11,"lines":["A"]},"align":"center"},{"n":12,"lines":["B"]}],"unboxed":""}`
	if _, err := extractWithKey(broken, "regions"); err == nil {
		t.Fatal("accepted a nested object from broken output")
	}
	ok := "Sure: {x} ```json\n{\"regions\":[{\"n\":1}],\"unboxed\":[]}\n```"
	raw, err := extractWithKey(ok, "regions")
	if err != nil || string(raw) != `{"regions":[{"n":1}],"unboxed":[]}` {
		t.Fatalf("got %s, %v", raw, err)
	}
	if k := firstKey(`{"critique":"...","regions":{}}`); k != "critique" {
		t.Fatalf("firstKey = %q", k)
	}
}

func TestStageOf(t *testing.T) {
	for in, want := range map[string]string{"ocr-p3": "ocr", "translate-en": "translate:en", "retranslate-de": "retranslate:de", "scene": "scene"} {
		if got := StageOf(in); got != want {
			t.Errorf("StageOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPriceFor(t *testing.T) {
	if p := priceFor("openrouter:anthropic/claude-sonnet-5-5"); p.Out != 10 {
		t.Fatalf("aggregator prefix: %+v", p)
	}
	u := Usage{InputTokens: 1_000_000, OutputTokens: 1_000_000}
	if c := priceFor("anthropic:claude-opus-5-5").cost(u); c != 24 {
		t.Fatalf("cost = %v", c)
	}
}

func TestCredits(t *testing.T) {
	for cost, want := range map[float64]int{0: 0, 0.0001: 1, 0.005: 1, 0.01: 2, 0.15255: 31, 1: 200} {
		if got := Credits(cost); got != want {
			t.Errorf("Credits(%v) = %d, want %d", cost, got, want)
		}
	}
}

func TestNewCall(t *testing.T) {
	old := newCall("ocr-p3-0", "ocr-p3", "ocr", logEntry{Model: "opus", CostUSD: 0.15, Duration: "11s"})
	if old.Backend != "claude-cli" || old.Model != "opus" || old.Label != "p3" || old.Credits != 30 || old.DurationMs != 11000 {
		t.Fatalf("old log: %+v", old)
	}
	local := newCall("scene-0", "scene", "scene", logEntry{Backend: "ollama", Model: "ollama:gemma4", CostUSD: 0.2})
	if !local.Local || local.Credits != 0 || local.Model != "gemma4" {
		t.Fatalf("local: %+v", local)
	}
}

func TestNaturalLess(t *testing.T) {
	if !naturalLess("ocr-p2-0", "ocr-p10-0") || naturalLess("ocr-p10-0", "ocr-p2-0") || !naturalLess("ocr-p2-0", "ocr-p2-1") {
		t.Fatal("natural order")
	}
}
