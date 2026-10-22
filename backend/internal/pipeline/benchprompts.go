package pipeline

import "fmt"

// BenchCall is one OCR request in the call-log shape llmbench replays.
type BenchCall struct {
	Name   string   `json:"name"`
	Prompt string   `json:"prompt"`
	Images []string `json:"images"`
}

type stripBox struct {
	ocrBox
	Panel int
	Draft string
}

func withSchema(prompt, schema string) string {
	return prompt + "\n\nReturn ONLY one JSON object matching this shape, no prose and no code fences:\n" + schema
}

// stripOCRRequest renders one OCR request for every region of the strip:
// panel images first, then (with crops) one close-up per region. draft maps
// region id to a local OCR engine's reading for the model to correct.
func (r *runState) stripOCRRequest(draft map[string]string, crops bool) (string, []string, error) {
	var panelImages, cropImages []string
	var boxes []stripBox
	for _, panel := range r.panels {
		n := 0
		for _, reg := range r.regions {
			if reg.PanelID != panel.ID {
				continue
			}
			n++
			boxes = append(boxes, stripBox{
				ocrBox: ocrBox{N: reg.Order, Class: reg.DetClass, Hint: classHints[reg.DetClass]},
				Panel:  len(panelImages) + 1, Draft: draft[reg.ID],
			})
			cropImages = append(cropImages, r.cropPath(reg.ID))
		}
		if n > 0 {
			panelImages = append(panelImages, r.debugPath(panel.ID))
		}
	}
	for i := range boxes {
		boxes[i].Image = len(panelImages) + i + 1
	}
	prompt, err := render("ocr-strip", r.withSrc(map[string]any{"Boxes": boxes, "NPanels": len(panelImages), "Draft": draft != nil, "Crops": crops}))
	if !crops {
		return prompt, panelImages, err
	}
	return prompt, append(panelImages, cropImages...), err
}

// OCRBenchCalls renders the OCR requests for id without calling a model:
// one per panel, one for the whole strip, and for each named set of drafts
// (region id -> text from a local OCR engine) whole-strip requests that ask
// the model to correct them, with and without close-ups.
func (p *Pipeline) OCRBenchCalls(id string, drafts map[string]map[string]string) ([]BenchCall, error) {
	r, err := p.load(id, "")
	if err != nil {
		return nil, err
	}
	if err := r.ensureDebugImages(); err != nil {
		return nil, err
	}
	var calls []BenchCall
	for _, panel := range r.panels {
		images := []string{r.debugPath(panel.ID)}
		var boxes []ocrBox
		for _, reg := range r.regions {
			if reg.PanelID == panel.ID {
				images = append(images, r.cropPath(reg.ID))
				boxes = append(boxes, ocrBox{N: reg.Order, Image: len(images), Class: reg.DetClass, Hint: classHints[reg.DetClass]})
			}
		}
		if len(boxes) == 0 {
			continue
		}
		prompt, err := render("ocr", r.withSrc(map[string]any{"Boxes": boxes}))
		if err != nil {
			return nil, err
		}
		calls = append(calls, BenchCall{Name: "ocr-" + panel.ID, Prompt: withSchema(prompt, ocrSchema), Images: images})
	}
	add := func(name string, draft map[string]string, crops bool) error {
		prompt, images, err := r.stripOCRRequest(draft, crops)
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		calls = append(calls, BenchCall{Name: name, Prompt: withSchema(prompt, ocrSchema), Images: images})
		return nil
	}
	if err := add("ocr-strip", nil, true); err != nil {
		return nil, err
	}
	for name, d := range drafts {
		if err := add("ocr-strip-"+name, d, true); err != nil {
			return nil, err
		}
		if err := add("ocr-strip-"+name+"-nocrops", d, false); err != nil {
			return nil, err
		}
	}
	return calls, nil
}
