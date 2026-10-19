package pipeline

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"comic-translator/backend/internal/llm"
)

var (
	ErrNotFound = errors.New("not found")
	ErrNotReady = errors.New("pipeline has not reached this stage yet")
	ErrConflict = errors.New("conflict")
)

// load reads every available stage output for id into a runState.
func (p *Pipeline) load(id, lang string) (*runState, error) {
	meta, err := p.Store.Meta(id)
	if err != nil {
		return nil, ErrNotFound
	}
	r := &runState{p: p, id: id, lang: lang, meta: meta, emit: func(Event) {}}
	s := p.Store
	if _, err := s.LoadStage(id, "panels", vPanels, &r.panels); err != nil {
		return nil, err
	}
	for _, st := range []struct {
		name string
		ver  int
	}{{"ocr", vOCR}, {"order", vOrder}, {"detect", vDetect}} {
		if ok, err := s.LoadStage(id, st.name, st.ver, &r.regions); err != nil {
			return nil, err
		} else if ok {
			break
		}
	}
	var sc Scene
	if ok, _ := s.LoadStage(id, "scene", vScene, &sc); ok {
		r.scene = &sc
	}
	var cl cleanResult
	if ok, _ := s.LoadStage(id, "clean", vClean, &cl); ok {
		r.clean = &cl
	}
	r.applySpeakers()
	return r, nil
}

func (r *runState) currentRegions() []Region {
	if r.clean == nil {
		return r.regions
	}
	out := make([]Region, len(r.clean.Regions))
	for i, reg := range r.clean.Regions {
		reg.Speaker = r.speaker(reg.ID)
		out[i] = reg
	}
	return out
}

func (p *Pipeline) Strip(id string) (*Strip, error) {
	r, err := p.load(id, "")
	if err != nil {
		return nil, err
	}
	st := &Strip{
		Meta:     r.meta,
		Panels:   r.panels,
		Regions:  r.currentRegions(),
		Scene:    r.scene,
		Stages:   p.stageStatus(id),
		ImageURL: ImageURL(id, "orig.png"),
	}
	if st.Panels == nil {
		st.Panels = []Panel{}
	}
	if st.Regions == nil {
		st.Regions = []Region{}
	}
	if r.clean != nil {
		st.CleanURL = fmt.Sprintf("%s?v=%d", ImageURL(id, "clean.png"), r.clean.Rev)
	}
	return st, nil
}

func (p *Pipeline) stageStatus(id string) map[string]string {
	vers := map[string]int{"panels": vPanels, "detect": vDetect, "order": vOrder, "ocr": vOCR, "scene": vScene, "clean": vClean}
	out := map[string]string{"ingest": StatusDone}
	for name, v := range vers {
		if _, err := os.Stat(p.Store.Path(id, "stages", fmt.Sprintf("%s@v%d.json", name, v))); err == nil {
			out[name] = StatusDone
		}
	}
	for _, lang := range p.Store.Langs(id) {
		if _, err := os.Stat(p.Store.Path(id, "stages", fmt.Sprintf("translate:%s@v%d.json", lang, vTranslate))); err == nil {
			out["translate:"+lang] = StatusDone
		}
		var t Translation
		if ok, _ := p.Store.LoadTranslation(id, lang, vReview, &t); ok {
			out["review:"+lang] = StatusDone
		}
	}
	return out
}

func (p *Pipeline) Summaries(limit int) ([]StripSummary, error) {
	metas, err := p.Store.Recent(limit)
	if err != nil {
		return nil, err
	}
	out := []StripSummary{}
	for _, m := range metas {
		out = append(out, StripSummary{
			ID: m.ID, OrigName: m.OrigName, CreatedAt: m.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			Width: m.Width, Height: m.Height, ThumbURL: ImageURL(m.ID, "orig.png"), Langs: p.Store.Langs(m.ID),
		})
	}
	return out, nil
}

// Translation returns the active version of (id, lang).
func (p *Pipeline) Translation(id, lang string) (*Translation, error) {
	vs, err := p.Versions(id, lang)
	if err != nil {
		return nil, err
	}
	v := vs.active()
	if v == nil {
		return nil, ErrNotFound
	}
	return v.translation(lang), nil
}

// SaveEdit stores editor changes. A user version is edited in place; editing
// an LLM version forks it into a new user version so the original stays intact.
func (p *Pipeline) SaveEdit(id, lang string, t Translation) (*Translation, error) {
	if t.Regions == nil {
		t.Regions = map[string]TrRegion{}
	}
	var out *Translation
	_, err := p.editVersions(id, lang, func(vs *TrVersions) error {
		v := vs.active()
		if t.Version != "" {
			v = vs.find(t.Version)
		}
		if v == nil || v.Source != SourceUser {
			fork := TrVersion{Source: SourceUser, CreatedAt: now()}
			if v != nil {
				fork.From, fork.Label = v.ID, "Edit of "+v.Label
			}
			v = vs.add(fork)
		}
		v.Regions, v.UpdatedAt = t.Regions, now()
		out = v.translation(lang)
		return nil
	})
	return out, err
}

type RegionPatch struct {
	Replace *bool `json:"replace"`
	Source  *struct {
		Text  string   `json:"text"`
		Lines []string `json:"lines"`
	} `json:"source"`
}

func (p *Pipeline) PatchRegion(id, rid string, patch RegionPatch) (*Region, error) {
	defer p.lock(id)()
	r, err := p.load(id, "")
	if err != nil {
		return nil, err
	}
	stageName, ver := "ocr", vOCR
	if ok, _ := p.Store.LoadStage(id, "ocr", vOCR, &[]Region{}); !ok {
		stageName, ver = "order", vOrder
	}
	apply := func(regs []Region) (bool, bool) {
		for i := range regs {
			if regs[i].ID != rid {
				continue
			}
			changed := patch.Replace != nil && *patch.Replace != regs[i].Replace
			if patch.Replace != nil {
				regs[i].Replace = *patch.Replace
			}
			if patch.Source != nil {
				regs[i].Source = patchSource(regs[i].Source, patch.Source.Text, patch.Source.Lines)
			}
			return true, changed
		}
		return false, false
	}
	found, changed := apply(r.regions)
	if !found {
		return nil, ErrNotFound
	}
	if err := p.Store.SaveStage(id, stageName, ver, r.regions); err != nil {
		return nil, err
	}
	if r.clean != nil {
		apply(r.clean.Regions)
		if changed {
			img, err := r.image()
			if err != nil {
				return nil, err
			}
			if r.clean, err = p.erase(id, img, r.clean.Regions); err != nil {
				return nil, err
			}
		} else if err := p.Store.SaveStage(id, "clean", vClean, r.clean); err != nil {
			return nil, err
		}
	}
	for _, reg := range r.currentRegions() {
		if reg.ID == rid {
			return &reg, nil
		}
	}
	return nil, ErrNotFound
}

func patchSource(old *Source, text string, lines []string) *Source {
	s := &Source{Align: "center", Caps: true}
	if old != nil {
		s.Align, s.Caps = old.Align, old.Caps
	}
	lines = cleanLines(lines)
	if len(lines) == 0 {
		lines = cleanLines(strings.Split(text, "\n"))
	}
	if text == "" {
		text = strings.Join(lines, " ")
	}
	s.Text, s.Lines = strings.Join(strings.Fields(text), " "), lines
	return s
}

// Retranslate reruns translate and review for the given regions (all when
// empty) and merges the result into the active version.
func (p *Pipeline) Retranslate(ctx context.Context, id, lang string, regionIDs []string, hint string) (*Translation, error) {
	r, err := p.load(id, lang)
	if err != nil {
		return nil, err
	}
	if r.scene == nil {
		return nil, ErrNotReady
	}
	defer p.lock(id + "/" + lang)()
	cur, err := p.Translation(id, lang)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrNotReady
	} else if err != nil {
		return nil, err
	}
	pass := trPass{ids: r.translatable(regionIDs), current: cur.Regions, hint: hint, edit: true}
	if len(pass.ids) == 0 {
		return nil, ErrNotFound
	}
	r.meter = &llm.Meter{}
	draft, err := r.translatePass(ctx, pass)
	if err != nil {
		return nil, err
	}
	final, _, err := r.reviewPass(ctx, pass, draft)
	if err != nil {
		return nil, err
	}
	var out *Translation
	_, err = p.editVersions(id, lang, func(vs *TrVersions) error {
		v := vs.find(cur.Version)
		if v == nil {
			return ErrNotFound
		}
		if v.Regions == nil {
			v.Regions = map[string]TrRegion{}
		}
		for rid, t := range final {
			v.Regions[rid] = t
		}
		total := r.meter.Total()
		if v.Usage == nil {
			v.Usage = &llm.MeterTotal{}
		}
		v.Usage.Add(total)
		v.UpdatedAt = now()
		out = v.translation(lang)
		return nil
	})
	return out, err
}

// Usage aggregates token and cost logs of every LLM call made for the strip.
func (p *Pipeline) Usage(id string) (*llm.Report, error) {
	if !p.Store.Has(id) {
		return nil, ErrNotFound
	}
	return llm.ReadUsage(p.Store.Path(id, "llm"))
}
