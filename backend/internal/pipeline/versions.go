package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"

	"comic-translator/backend/internal/llm"
)

const SourceUser = "user"

// TrVersion is one saved translation of a strip into one language. Source is
// "user" for hand-made versions, else "llm" with Model naming the backends.
type TrVersion struct {
	ID        string          `json:"id"`
	Label     string          `json:"label"`
	Source    string          `json:"source"`
	Model     string          `json:"model,omitempty"`
	From      string          `json:"from,omitempty"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	Usage     *llm.MeterTotal `json:"usage,omitempty"`
	// ReviewError is set when the review pass failed and Regions is the unreviewed draft.
	ReviewError string              `json:"reviewError,omitempty"`
	Regions     map[string]TrRegion `json:"regions"`
}

type TrVersions struct {
	Lang     string      `json:"lang"`
	Active   string      `json:"active"`
	Versions []TrVersion `json:"versions"`
}

type VersionRequest struct {
	Spec    string              `json:"spec"`
	Label   string              `json:"label"`
	From    string              `json:"from"`
	Regions map[string]TrRegion `json:"regions"`
}

type VersionPatch struct {
	Label   *string             `json:"label"`
	Regions map[string]TrRegion `json:"regions"`
}

func (vs *TrVersions) find(vid string) *TrVersion {
	for i := range vs.Versions {
		if vs.Versions[i].ID == vid {
			return &vs.Versions[i]
		}
	}
	return nil
}

func (vs *TrVersions) active() *TrVersion {
	if v := vs.find(vs.Active); v != nil {
		return v
	}
	if len(vs.Versions) == 0 {
		return nil
	}
	return &vs.Versions[len(vs.Versions)-1]
}

func (vs *TrVersions) add(v TrVersion) *TrVersion {
	n := 0
	for _, old := range vs.Versions {
		var k int
		if _, err := fmt.Sscanf(old.ID, "v%d", &k); err == nil {
			n = max(n, k)
		}
	}
	v.ID = fmt.Sprintf("v%d", n+1)
	if v.Label == "" {
		v.Label = v.Model
	}
	if v.Label == "" {
		v.Label = "My version"
	}
	vs.Versions = append(vs.Versions, v)
	vs.Active = v.ID
	return &vs.Versions[len(vs.Versions)-1]
}

func (v *TrVersion) translation(lang string) *Translation {
	return &Translation{
		Lang: lang, Final: true, Edited: v.Source == SourceUser, UpdatedAt: v.UpdatedAt, Regions: v.Regions,
		Version: v.ID, Label: v.Label, Source: v.Source, Model: v.Model,
	}
}

func cloneRegions(m map[string]TrRegion) map[string]TrRegion {
	out := make(map[string]TrRegion, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// Versions loads the saved versions of (id, lang). Strips translated before
// versions existed are migrated in memory: pipeline result -> v1, user edit
// -> v2 (active). Nothing is written until the first change.
func (p *Pipeline) Versions(id, lang string) (*TrVersions, error) {
	if !p.Store.Has(id) {
		return nil, ErrNotFound
	}
	vs := &TrVersions{Lang: lang, Versions: []TrVersion{}}
	if ok, err := p.Store.LoadVersions(id, lang, vs); err != nil || ok {
		return vs, err
	}
	var base, edit Translation
	if ok, err := p.Store.LoadTranslation(id, lang, vReview, &base); err != nil {
		return nil, err
	} else if ok {
		vs.add(TrVersion{
			Source: "llm", Model: p.loggedModel(id, "review-"+lang),
			CreatedAt: base.UpdatedAt, UpdatedAt: base.UpdatedAt, Regions: base.Regions,
		})
	}
	if ok, err := p.Store.LoadEdit(id, lang, &edit); err != nil {
		return nil, err
	} else if ok {
		vs.add(TrVersion{Source: SourceUser, From: vs.Active, CreatedAt: edit.UpdatedAt, UpdatedAt: edit.UpdatedAt, Regions: edit.Regions})
	}
	return vs, nil
}

// loggedModel reads the model of the first logged call named name, for
// labeling migrated versions.
func (p *Pipeline) loggedModel(id, name string) string {
	data, err := os.ReadFile(p.Store.Path(id, "llm", name+"-0.json"))
	if err != nil {
		return "unknown"
	}
	var entry struct {
		Backend string `json:"backend"`
		Model   string `json:"model"`
	}
	if json.Unmarshal(data, &entry) != nil || entry.Model == "" {
		return "unknown"
	}
	if entry.Backend == "" && !strings.Contains(entry.Model, ":") {
		return "claude-cli:" + entry.Model
	}
	return entry.Model
}

// editVersions runs fn on the versions of (id, lang) and saves them if fn
// succeeds. Only the read-modify-write is locked, not LLM calls.
func (p *Pipeline) editVersions(id, lang string, fn func(*TrVersions) error) (*TrVersions, error) {
	defer p.lock("versions/" + id + "/" + lang)()
	vs, err := p.Versions(id, lang)
	if err != nil {
		return nil, err
	}
	if err := fn(vs); err != nil {
		return nil, err
	}
	return vs, p.Store.SaveVersions(id, lang, vs)
}

func (p *Pipeline) addVersion(id, lang string, v TrVersion) (*TrVersion, error) {
	var out TrVersion
	_, err := p.editVersions(id, lang, func(vs *TrVersions) error {
		out = *vs.add(v)
		return nil
	})
	return &out, err
}

// NewVersion saves a new version and makes it active. With Spec it runs
// translate + review on that backend; otherwise it copies From (default the
// active version), overlaid with Regions, as a user version.
func (p *Pipeline) NewVersion(ctx context.Context, id, lang string, req VersionRequest) (*TrVersion, error) {
	if req.Spec != "" {
		return p.generateVersion(ctx, id, lang, req)
	}
	var out TrVersion
	_, err := p.editVersions(id, lang, func(vs *TrVersions) error {
		src := vs.active()
		if req.From != "" {
			src = vs.find(req.From)
			if src == nil {
				return ErrNotFound
			}
		}
		regions := map[string]TrRegion{}
		from := ""
		if src != nil {
			regions, from = cloneRegions(src.Regions), src.ID
		}
		for k, v := range req.Regions {
			regions[k] = v
		}
		ts := now()
		out = *vs.add(TrVersion{Label: req.Label, Source: SourceUser, From: from, CreatedAt: ts, UpdatedAt: ts, Regions: regions})
		return nil
	})
	return &out, err
}

func (p *Pipeline) generateVersion(ctx context.Context, id, lang string, req VersionRequest) (*TrVersion, error) {
	router, ok := p.LLM.(*llm.Router)
	if !ok {
		return nil, fmt.Errorf("backend override needs the LLM router")
	}
	if _, err := router.Client(req.Spec); err != nil {
		return nil, fmt.Errorf("spec %q: %w", req.Spec, err)
	}
	r, err := p.load(id, lang)
	if err != nil {
		return nil, err
	}
	if r.scene == nil {
		return nil, ErrNotReady
	}
	r.meter = &llm.Meter{}
	ctx = llm.WithSpec(ctx, req.Spec)
	pass := trPass{ids: r.translatable(nil)}
	draft, err := r.translatePass(ctx, pass)
	if err != nil {
		return nil, err
	}
	final, _, err := r.reviewPass(ctx, pass, draft)
	reviewErr := ""
	if err != nil {
		if ctx.Err() != nil {
			return nil, err
		}
		final, reviewErr = draft, err.Error()
	}
	v := r.llmVersion(req.Label, final)
	v.ReviewError = reviewErr
	return p.addVersion(id, lang, v)
}

func (r *runState) llmVersion(label string, regions map[string]TrRegion) TrVersion {
	ts := now()
	v := TrVersion{Label: label, Source: "llm", CreatedAt: ts, UpdatedAt: ts, Regions: regions}
	if r.meter != nil {
		total := r.meter.Total()
		v.Usage, v.Model = &total, strings.Join(total.Models, ", ")
	}
	return v
}

// PatchVersion renames a version or replaces some of its regions in place.
func (p *Pipeline) PatchVersion(id, lang, vid string, patch VersionPatch) (*TrVersion, error) {
	var out TrVersion
	_, err := p.editVersions(id, lang, func(vs *TrVersions) error {
		v := vs.find(vid)
		if v == nil {
			return ErrNotFound
		}
		if patch.Label != nil {
			v.Label = strings.TrimSpace(*patch.Label)
		}
		if patch.Regions != nil {
			if v.Regions == nil {
				v.Regions = map[string]TrRegion{}
			}
			for k, t := range patch.Regions {
				v.Regions[k] = t
			}
		}
		v.UpdatedAt = now()
		out = *v
		return nil
	})
	return &out, err
}

func (p *Pipeline) ActivateVersion(id, lang, vid string) (*TrVersions, error) {
	return p.editVersions(id, lang, func(vs *TrVersions) error {
		if vs.find(vid) == nil {
			return ErrNotFound
		}
		vs.Active = vid
		return nil
	})
}

func (p *Pipeline) DeleteVersion(id, lang, vid string) (*TrVersions, error) {
	return p.editVersions(id, lang, func(vs *TrVersions) error {
		i := slices.IndexFunc(vs.Versions, func(v TrVersion) bool { return v.ID == vid })
		if i < 0 {
			return ErrNotFound
		}
		if len(vs.Versions) == 1 {
			return fmt.Errorf("%w: cannot delete the only version", ErrConflict)
		}
		vs.Versions = slices.Delete(vs.Versions, i, i+1)
		if vs.Active == vid {
			vs.Active = vs.Versions[len(vs.Versions)-1].ID
		}
		return nil
	})
}
