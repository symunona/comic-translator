// ocrprompts writes OCR requests for strips in the call-log shape, for
// llmbench to replay: per panel, whole strip, and whole strip with drafts
// from a local OCR engine to correct.
//
//	go run ./cmd/ocrprompts -data ../data -drafts paddle=drafts.json -out ../bench/llm/prompts 6cbd56cd 3b343686
package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"
	"strings"

	"comic-translator/backend/internal/pipeline"
	"comic-translator/backend/internal/store"
)

type draftFlags map[string]string

func (d draftFlags) String() string { return "" }
func (d draftFlags) Set(v string) error {
	name, path, _ := strings.Cut(v, "=")
	d[name] = path
	return nil
}

func main() {
	dataDir := flag.String("data", "../data", "strip data root")
	out := flag.String("out", "../bench/llm/prompts", "output directory")
	draftFiles := draftFlags{}
	flag.Var(draftFiles, "drafts", "name=file.json with {\"<id prefix>/r3\": \"text\"}, repeatable")
	flag.Parse()
	st, err := store.NewFS(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	p := pipeline.New(st, nil, nil)
	all := map[string]map[string]string{}
	for name, path := range draftFiles {
		data, err := os.ReadFile(path)
		if err != nil {
			log.Fatal(err)
		}
		m := map[string]string{}
		if err := json.Unmarshal(data, &m); err != nil {
			log.Fatal(err)
		}
		all[name] = m
	}
	entries, _ := os.ReadDir(st.Root())
	for _, prefix := range flag.Args() {
		var id string
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), prefix) {
				id = e.Name()
			}
		}
		if id == "" {
			log.Fatalf("no strip %s", prefix)
		}
		drafts := map[string]map[string]string{}
		for name, m := range all {
			d := map[string]string{}
			for k, v := range m {
				if rest, ok := strings.CutPrefix(k, prefix+"/"); ok {
					d[rest] = v
				}
			}
			if len(d) > 0 {
				drafts[name] = d
			}
		}
		calls, err := p.OCRBenchCalls(id, drafts)
		if err != nil {
			log.Fatalf("%s: %v", prefix, err)
		}
		dir := filepath.Join(*out, id, "llm")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Fatal(err)
		}
		for _, c := range calls {
			data, _ := json.MarshalIndent(c, "", "  ")
			if err := os.WriteFile(filepath.Join(dir, c.Name+".json"), data, 0o644); err != nil {
				log.Fatal(err)
			}
		}
		log.Printf("%s: %d calls", prefix, len(calls))
	}
}
