package pipeline

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"text/template"
	"time"
	"unicode/utf8"
)

//go:embed prompts/*.tmpl
var promptFS embed.FS

var prompts = template.Must(template.ParseFS(promptFS, "prompts/*.tmpl"))

func render(name string, data any) (string, error) {
	var b strings.Builder
	err := prompts.ExecuteTemplate(&b, name+".tmpl", data)
	return b.String(), err
}

var langNames = map[string]string{
	"en": "English", "de": "German", "fr": "French", "es": "Spanish",
	"it": "Italian", "pl": "Polish", "hu": "Hungarian", "nl": "Dutch",
	"pt": "Portuguese", "cs": "Czech", "sk": "Slovak", "ro": "Romanian",
}

func LangName(code string) string {
	if n, ok := langNames[code]; ok {
		return n
	}
	return code
}

const ocrSchema = `{"regions":[{"n":<box number>,"kind":"speech|thought|caption|sfx|sign|none","lines":["LINE 1","LINE 2"],"align":"left|center|right","caps":true}],"unboxed":["text seen outside every box"]}`

const sceneSchema = `{"summary":"...","characters":[{"name":"label","description":"..."}],"panels":[{"panelId":"p0","description":"..."}],"speakers":{"r0":"label"},"notes":["..."]}`

const translateSchema = `{"regions":{"r0":{"literal":"...","text":"...","notes":"..."}}}`

const reviewSchema = `{"critique":"...","regions":{"r0":{"text":"...","notes":"..."}}}`

type ocrBox struct {
	N     int
	Image int
	Class string
	Hint  string
}

type ocrReply struct {
	Regions []struct {
		N     int      `json:"n"`
		Kind  string   `json:"kind"`
		Lines []string `json:"lines"`
		Align string   `json:"align"`
		Caps  *bool    `json:"caps"`
	} `json:"regions"`
	Unboxed []string `json:"unboxed"`
}

type panelOCR struct {
	Regions []Region `json:"regions"`
	Unboxed []string `json:"unboxed"`
}

var classHints = map[string]string{
	textBubbleClass: "text inside a bubble",
	textFreeClass:   "text outside bubbles",
	bubbleClass:     "a bubble where no text was detected; it may be empty or hold small text",
}

var validKinds = map[string]bool{"speech": true, "thought": true, "caption": true, "sfx": true, "sign": true, "none": true}

func defaultReplace(kind string) bool {
	return kind == "speech" || kind == "thought" || kind == "caption"
}

func (r *runState) runOCR(ctx context.Context) error {
	byPanel := map[string][]int{}
	for i, reg := range r.regions {
		byPanel[reg.PanelID] = append(byPanel[reg.PanelID], i)
	}
	var (
		mu       sync.Mutex
		wg       sync.WaitGroup
		firstErr error
		done     int
	)
	total := len(byPanel)
	r.stage("ocr", StatusRunning, "", &Progress{Done: 0, Total: total})
	for _, panel := range r.panels {
		idx := byPanel[panel.ID]
		if len(idx) == 0 {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := r.ocrPanel(ctx, panel, idx)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = fmt.Errorf("panel %s: %w", panel.ID, err)
				}
				return
			}
			for k, i := range idx {
				r.regions[i] = res.Regions[k]
				r.data("region", r.regions[i])
			}
			done++
			r.stage("ocr", StatusRunning, "", &Progress{Done: done, Total: total})
		}()
	}
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	return r.p.Store.SaveStage(r.id, "ocr", vOCR, r.regions)
}

func (r *runState) ocrPanel(ctx context.Context, panel Panel, idx []int) (*panelOCR, error) {
	stageName := "ocr-" + panel.ID
	var cached panelOCR
	if ok, err := r.p.Store.LoadStage(r.id, stageName, vOCR, &cached); ok && err == nil && r.sameRegions(cached.Regions, idx) {
		for k, i := range idx {
			reg := r.regions[i]
			reg.Kind, reg.Source, reg.Replace = cached.Regions[k].Kind, cached.Regions[k].Source, cached.Regions[k].Replace
			cached.Regions[k] = reg
		}
		return &cached, nil
	}
	images := []string{r.debugPath(panel.ID)}
	var boxes []ocrBox
	for _, i := range idx {
		reg := r.regions[i]
		images = append(images, r.cropPath(reg.ID))
		boxes = append(boxes, ocrBox{N: reg.Order, Image: len(images), Class: reg.DetClass, Hint: classHints[reg.DetClass]})
	}
	prompt, err := render("ocr", map[string]any{"Boxes": boxes})
	if err != nil {
		return nil, err
	}
	raw, err := r.p.LLM.Call(r.llmCtx(ctx, stageName), prompt, images, ocrSchema)
	if err != nil {
		return nil, err
	}
	var reply ocrReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, err
	}
	byN := map[int]int{}
	for k, rr := range reply.Regions {
		byN[rr.N] = k
	}
	res := &panelOCR{Unboxed: reply.Unboxed}
	for _, i := range idx {
		reg := r.regions[i]
		reg.Kind, reg.Source = "none", nil
		if k, ok := byN[reg.Order]; ok {
			rr := reply.Regions[k]
			lines := cleanLines(rr.Lines)
			if validKinds[rr.Kind] {
				reg.Kind = rr.Kind
			}
			if len(lines) == 0 {
				reg.Kind = "none"
			} else {
				reg.Source = &Source{
					Text:  strings.Join(lines, " "),
					Lines: lines,
					Align: normAlign(rr.Align),
					Caps:  rr.Caps == nil || *rr.Caps,
				}
			}
		}
		reg.Replace = defaultReplace(reg.Kind)
		res.Regions = append(res.Regions, reg)
	}
	return res, r.p.Store.SaveStage(r.id, stageName, vOCR, res)
}

func (r *runState) sameRegions(cached []Region, idx []int) bool {
	if len(cached) != len(idx) {
		return false
	}
	for k, i := range idx {
		if cached[k].ID != r.regions[i].ID || cached[k].TextBox != r.regions[i].TextBox {
			return false
		}
	}
	return true
}

func cleanLines(lines []string) []string {
	var out []string
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}

func normAlign(a string) string {
	switch a {
	case "left", "right":
		return a
	}
	return "center"
}

func (r *runState) unboxed() map[string][]string {
	out := map[string][]string{}
	for _, panel := range r.panels {
		var res panelOCR
		if ok, _ := r.p.Store.LoadStage(r.id, "ocr-"+panel.ID, vOCR, &res); ok {
			out[panel.ID] = res.Unboxed
		}
	}
	return out
}

func (r *runState) panelImages() ([]string, []map[string]any) {
	var paths []string
	var list []map[string]any
	for _, p := range r.panels {
		paths = append(paths, r.debugPath(p.ID))
		list = append(list, map[string]any{"ID": p.ID, "Image": len(paths)})
	}
	return paths, list
}

func quoteLines(lines []string) string {
	q := make([]string, len(lines))
	for i, l := range lines {
		q[i] = fmt.Sprintf("%q", l)
	}
	return strings.Join(q, " / ")
}

// transcript lists regions per panel. With budgets it only includes
// translatable regions in ids and annotates speaker and budget.
func (r *runState) transcript(ids map[string]bool, withBudget bool) string {
	unboxed := r.unboxed()
	var b strings.Builder
	for _, p := range r.panels {
		fmt.Fprintf(&b, "Panel %s:\n", p.ID)
		for _, reg := range r.regions {
			if reg.PanelID != p.ID || (ids != nil && !ids[reg.ID]) {
				continue
			}
			if reg.Source == nil {
				if !withBudget {
					fmt.Fprintf(&b, "  %s [%s, detector %s]: (no text)\n", reg.ID, reg.Kind, reg.DetClass)
				}
				continue
			}
			fmt.Fprintf(&b, "  %s [%s", reg.ID, reg.Kind)
			if withBudget {
				if sp := r.speaker(reg.ID); sp != "" {
					fmt.Fprintf(&b, ", speaker: %s", sp)
				}
				mc, ml := budget(reg.Source)
				fmt.Fprintf(&b, ", maxChars %d, maxLines %d", mc, ml)
			} else {
				fmt.Fprintf(&b, ", detector %s", reg.DetClass)
			}
			fmt.Fprintf(&b, "]: %s\n", quoteLines(reg.Source.Lines))
		}
		if !withBudget && len(unboxed[p.ID]) > 0 {
			fmt.Fprintf(&b, "  (lettering outside any box, not editable: %s)\n", quoteLines(unboxed[p.ID]))
		}
	}
	return b.String()
}

func (r *runState) applySpeakers() {
	for i := range r.regions {
		r.regions[i].Speaker = r.speaker(r.regions[i].ID)
	}
}

func (r *runState) speaker(rid string) string {
	if r.scene == nil {
		return ""
	}
	return r.scene.Speakers[rid]
}

func budget(s *Source) (int, int) {
	return int(math.Ceil(float64(utf8.RuneCountInString(s.Text)) * 1.2)), max(len(s.Lines), 1) + 1
}

func (r *runState) runScene(ctx context.Context) error {
	images, list := r.panelImages()
	prompt, err := render("scene", map[string]any{"Panels": list, "Transcript": r.transcript(nil, false)})
	if err != nil {
		return err
	}
	raw, err := r.p.LLM.Call(r.llmCtx(ctx, "scene"), prompt, images, sceneSchema)
	if err != nil {
		return err
	}
	var sc Scene
	if err := json.Unmarshal(raw, &sc); err != nil {
		return err
	}
	if sc.Speakers == nil {
		sc.Speakers = map[string]string{}
	}
	r.scene = &sc
	return r.p.Store.SaveStage(r.id, "scene", vScene, r.scene)
}

func (r *runState) sceneText() string {
	data, _ := json.MarshalIndent(r.scene, "", "  ")
	return string(data)
}

func (r *runState) translatable(only []string) map[string]bool {
	want := map[string]bool{}
	for _, id := range only {
		want[id] = true
	}
	ids := map[string]bool{}
	for _, reg := range r.regions {
		if reg.Source != nil && reg.Kind != "none" && (len(only) == 0 || want[reg.ID]) {
			ids[reg.ID] = true
		}
	}
	return ids
}

type trPass struct {
	ids     map[string]bool
	current map[string]TrRegion
	hint    string
}

func (r *runState) promptData(pass trPass) map[string]any {
	var cur []string
	for _, reg := range r.regions {
		if t, ok := pass.current[reg.ID]; ok && !pass.ids[reg.ID] {
			cur = append(cur, fmt.Sprintf("  %s: %q", reg.ID, t.Text))
		}
	}
	return map[string]any{
		"Lang": r.lang, "LangName": LangName(r.lang),
		"Scene": r.sceneText(), "Transcript": r.transcript(pass.ids, true),
		"Current": strings.Join(cur, "\n"), "Hint": pass.hint,
	}
}

func (r *runState) translatePass(ctx context.Context, pass trPass) (map[string]TrRegion, error) {
	if len(pass.ids) == 0 {
		return map[string]TrRegion{}, nil
	}
	images, _ := r.panelImages()
	prompt, err := render("translate", r.promptData(pass))
	if err != nil {
		return nil, err
	}
	raw, err := r.p.LLM.Call(r.llmCtx(ctx, "translate-"+r.lang), prompt, images, translateSchema)
	if err != nil {
		return nil, err
	}
	var reply struct {
		Regions map[string]TrRegion `json:"regions"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, err
	}
	out := map[string]TrRegion{}
	for _, reg := range r.regions {
		if !pass.ids[reg.ID] {
			continue
		}
		t := reply.Regions[reg.ID]
		t.MaxChars, t.MaxLines = budget(reg.Source)
		out[reg.ID] = t
	}
	return out, nil
}

func (r *runState) reviewPass(ctx context.Context, pass trPass, draft map[string]TrRegion) (map[string]TrRegion, string, error) {
	if len(pass.ids) == 0 {
		return map[string]TrRegion{}, "", nil
	}
	images, _ := r.panelImages()
	data := r.promptData(pass)
	draftJSON, _ := json.MarshalIndent(sortedDraft(draft), "", "  ")
	data["Draft"] = string(draftJSON)
	prompt, err := render("review", data)
	if err != nil {
		return nil, "", err
	}
	raw, err := r.p.LLM.Call(r.llmCtx(ctx, "review-"+r.lang), prompt, images, reviewSchema)
	if err != nil {
		return nil, "", err
	}
	var reply struct {
		Critique json.RawMessage     `json:"critique"`
		Regions  map[string]TrRegion `json:"regions"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, "", err
	}
	out := map[string]TrRegion{}
	for id, d := range draft {
		f := d
		if rv, ok := reply.Regions[id]; ok && strings.TrimSpace(rv.Text) != "" {
			f.Text = rv.Text
			f.Notes = rv.Notes
		}
		out[id] = f
	}
	return out, critiqueText(reply.Critique), nil
}

func critiqueText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return string(raw)
}

type draftEntry struct {
	ID      string `json:"id"`
	Literal string `json:"literal"`
	Text    string `json:"text"`
	Notes   string `json:"notes,omitempty"`
}

func sortedDraft(d map[string]TrRegion) []draftEntry {
	var out []draftEntry
	for id, t := range d {
		out = append(out, draftEntry{id, t.Literal, t.Text, t.Notes})
	}
	sort.Slice(out, func(i, j int) bool { return regionNum(out[i].ID) < regionNum(out[j].ID) })
	return out
}

func regionNum(id string) int {
	var n int
	fmt.Sscanf(id, "r%d", &n)
	return n
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func (r *runState) runTranslate(ctx context.Context) error {
	regions, err := r.translatePass(ctx, trPass{ids: r.translatable(nil)})
	if err != nil {
		return err
	}
	r.draft = &Translation{Lang: r.lang, UpdatedAt: now(), Regions: regions}
	return r.p.Store.SaveStage(r.id, "translate:"+r.lang, vTranslate, r.draft)
}

func (r *runState) runReview(ctx context.Context) error {
	final, critique, err := r.reviewPass(ctx, trPass{ids: r.translatable(nil)}, r.draft.Regions)
	if err != nil {
		return err
	}
	if err := r.p.Store.SaveStage(r.id, "review:"+r.lang, vReview, reviewResult{Critique: critique}); err != nil {
		return err
	}
	t := Translation{Lang: r.lang, Final: true, UpdatedAt: now(), Regions: final}
	return r.p.Store.SaveTranslation(r.id, r.lang, vReview, t)
}
