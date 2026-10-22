package pipeline

import (
	"strings"
	"testing"

	"comic-translator/backend/internal/store"
)

func TestPromptsFollowSourceLanguage(t *testing.T) {
	for _, src := range []string{"", "en"} {
		r := &runState{lang: "hu", meta: store.Meta{SrcLang: src}}
		for _, name := range []string{"ocr", "scene", "translate", "review"} {
			out, err := render(name, r.withSrc(map[string]any{"Lang": "hu", "LangName": "Hungarian"}))
			if err != nil {
				t.Fatalf("%s/%q: %v", name, src, err)
			}
			napirajz := strings.Contains(out, "Napirajz")
			if (src == "") != napirajz && name != "translate" && name != "review" {
				t.Errorf("%s/%q: Napirajz hints = %v", name, src, napirajz)
			}
			if src == "en" && !strings.Contains(out, "English comic") {
				t.Errorf("%s/en: source language missing", name)
			}
		}
	}
}
