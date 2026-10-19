package pipeline

import (
	"context"
	"errors"
	"fmt"
	"image"
	"log"
	"slices"

	"comic-translator/backend/internal/detect"
)

const maxClientDetections = 300

var (
	ErrClientDetect = errors.New("detect runs in the browser: upload detections first")
	ErrBadInput     = errors.New("bad input")
)

type ClientPanel struct {
	PanelID    string            `json:"panelId"`
	Detections []ClientDetection `json:"detections"`
}

// ClientDetection is one raw model output in panel pixel coordinates (x1, y1, x2, y2).
type ClientDetection struct {
	Class string     `json:"class"`
	Score float32    `json:"score"`
	Box   [4]float64 `json:"box"`
}

type ClientDetect struct {
	Model  string        `json:"model"`
	Device string        `json:"device"`
	Ms     float64       `json:"ms"`
	Panels []ClientPanel `json:"panels"`
}

type PanelsResult struct {
	Panels   []Panel `json:"panels"`
	Detected bool    `json:"detected"`
}

// Panels returns the panel split for id, computing it if needed.
func (p *Pipeline) Panels(id string) (*PanelsResult, error) {
	meta, err := p.Store.Meta(id)
	if err != nil {
		return nil, ErrNotFound
	}
	defer p.lock(id)()
	r := &runState{p: p, id: id, meta: meta, emit: func(Event) {}}
	ok, err := p.Store.LoadStage(id, "panels", vPanels, &r.panels)
	if err != nil {
		return nil, err
	}
	if !ok {
		if err := r.runPanels(context.Background()); err != nil {
			return nil, err
		}
	}
	var regs []Region
	detected, _ := p.Store.LoadStage(id, "detect", vDetect, &regs)
	return &PanelsResult{Panels: r.panels, Detected: detected}, nil
}

// SaveClientDetect turns raw browser detections into the detect stage output,
// with the same per-panel postprocessing as the server detector.
func (p *Pipeline) SaveClientDetect(id string, in ClientDetect) ([]Region, error) {
	defer p.lock(id)()
	var panels []Panel
	if ok, err := p.Store.LoadStage(id, "panels", vPanels, &panels); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrNotReady
	}
	var existing []Region
	if ok, _ := p.Store.LoadStage(id, "detect", vDetect, &existing); ok {
		return existing, nil
	}
	byPanel := map[string][]ClientDetection{}
	total := 0
	for _, cp := range in.Panels {
		byPanel[cp.PanelID] = append(byPanel[cp.PanelID], cp.Detections...)
		total += len(cp.Detections)
	}
	if total > maxClientDetections*max(1, len(panels)) {
		return nil, fmt.Errorf("%w: too many detections", ErrBadInput)
	}
	regions := []Region{}
	for _, panel := range panels {
		rect := panel.BBox.Rect()
		var dets []detect.Detection
		for _, d := range byPanel[panel.ID] {
			if d.Score < minScore || !slices.Contains(detect.Classes, d.Class) {
				continue
			}
			b := image.Rect(int(d.Box[0]+0.5), int(d.Box[1]+0.5), int(d.Box[2]+0.5), int(d.Box[3]+0.5))
			b = b.Intersect(image.Rect(0, 0, rect.Dx(), rect.Dy()))
			if b.Empty() {
				continue
			}
			dets = append(dets, detect.Detection{Class: d.Class, Score: d.Score, Box: b.Add(rect.Min)})
		}
		for _, reg := range panelRegions(dets) {
			reg.PanelID = panel.ID
			reg.ID = fmt.Sprintf("d%d", len(regions))
			regions = append(regions, reg)
		}
	}
	if err := p.Store.SaveStage(id, "detect", vDetect, regions); err != nil {
		return nil, err
	}
	log.Printf("%s detect: browser %s on %s, %d panels, %.0f ms, %d regions", id[:8], in.Model, in.Device, len(panels), in.Ms, len(regions))
	return regions, nil
}
