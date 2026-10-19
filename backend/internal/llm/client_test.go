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

func TestExtractJSONTrailingComma(t *testing.T) {
	raw, err := ExtractJSON("```json\n{\"regions\": {\"r0\": {\"text\": \"A, }\",},\n },}\n```")
	if err != nil || string(raw) != "{\"regions\": {\"r0\": {\"text\": \"A, }\"}\n }}" {
		t.Fatalf("got %s, %v", raw, err)
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
