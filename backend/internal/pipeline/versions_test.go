package pipeline

import (
	"testing"
	"time"

	"comic-translator/backend/internal/store"
)

func newTestPipeline(t *testing.T) (*Pipeline, string) {
	t.Helper()
	st, err := store.NewFS(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := "abc"
	if err := st.SaveMeta(store.Meta{ID: id, CreatedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	return New(st, nil, nil), id
}

func TestVersionsMigrateLegacy(t *testing.T) {
	p, id := newTestPipeline(t)
	base := Translation{Lang: "en", Final: true, UpdatedAt: "2026-01-01T00:00:00Z", Regions: map[string]TrRegion{"r0": {Text: "HELLO"}}}
	edit := Translation{Lang: "en", Edited: true, UpdatedAt: "2026-01-02T00:00:00Z", Regions: map[string]TrRegion{"r0": {Text: "HI"}}}
	if err := p.Store.SaveTranslation(id, "en", vReview, base); err != nil {
		t.Fatal(err)
	}
	if err := p.Store.SaveEdit(id, "en", edit); err != nil {
		t.Fatal(err)
	}
	vs, err := p.Versions(id, "en")
	if err != nil {
		t.Fatal(err)
	}
	if len(vs.Versions) != 2 || vs.Active != "v2" {
		t.Fatalf("want 2 versions, active v2, got %+v", vs)
	}
	if vs.Versions[0].Source != "llm" || vs.Versions[1].Source != SourceUser || vs.Versions[1].From != "v1" {
		t.Fatalf("bad sources: %+v", vs.Versions)
	}
	tr, err := p.Translation(id, "en")
	if err != nil || tr.Regions["r0"].Text != "HI" || !tr.Edited {
		t.Fatalf("active translation = %+v, %v", tr, err)
	}
}

func TestSaveEditForksLLMVersion(t *testing.T) {
	p, id := newTestPipeline(t)
	if _, err := p.addVersion(id, "en", TrVersion{Source: "llm", Model: "ollama:x", Regions: map[string]TrRegion{"r0": {Text: "A"}}}); err != nil {
		t.Fatal(err)
	}
	tr, err := p.SaveEdit(id, "en", Translation{Regions: map[string]TrRegion{"r0": {Text: "B"}}})
	if err != nil {
		t.Fatal(err)
	}
	if tr.Version != "v2" || tr.Source != SourceUser {
		t.Fatalf("edit should fork into v2 user, got %+v", tr)
	}
	if _, err := p.SaveEdit(id, "en", Translation{Regions: map[string]TrRegion{"r0": {Text: "C"}}}); err != nil {
		t.Fatal(err)
	}
	vs, _ := p.Versions(id, "en")
	if len(vs.Versions) != 2 || vs.Versions[0].Regions["r0"].Text != "A" || vs.Versions[1].Regions["r0"].Text != "C" {
		t.Fatalf("want llm untouched and user edited in place, got %+v", vs.Versions)
	}
	if _, err := p.ActivateVersion(id, "en", "v1"); err != nil {
		t.Fatal(err)
	}
	if tr, _ := p.Translation(id, "en"); tr.Version != "v1" {
		t.Fatalf("activate failed: %+v", tr)
	}
	if _, err := p.DeleteVersion(id, "en", "v1"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.DeleteVersion(id, "en", "v2"); err == nil {
		t.Fatal("deleting the only version must fail")
	}
}
