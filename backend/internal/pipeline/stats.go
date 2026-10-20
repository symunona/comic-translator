package pipeline

import (
	"strings"
	"time"
)

// StageStat is what one stage run cost in wall time and what it produced,
// for the debug step view. Stored per strip in stages/stats.json.
type StageStat struct {
	Ms     int64          `json:"ms"`
	At     string         `json:"at"`
	Where  string         `json:"where,omitempty"`
	Detail string         `json:"detail,omitempty"`
	Counts map[string]int `json:"counts,omitempty"`
}

var stageDetail = map[string]string{
	"ingest": "sha256 + decode",
	"panels": "XY-cut on ink projection, ink luma<128, gap>=12px",
	"detect": "RT-DETR comic text+bubble detector, conf>=0.35, NMS IoU 0.5",
	"order":  "rows by y overlap, then left to right",
	"clean":  "connected components, ink luma<160, dilate 2px, paper fill",
}

// Stats returns the recorded stage stats of id, keyed by stage name
// (translate:en etc. for language stages).
func (p *Pipeline) Stats(id string) map[string]StageStat {
	out := map[string]StageStat{}
	p.Store.LoadStage(id, "stats", 1, &out)
	return out
}

func (p *Pipeline) recordStat(id, stage string, st StageStat) {
	defer p.lock("stats/" + id)()
	all := p.Stats(id)
	if st.At == "" {
		st.At = time.Now().UTC().Format(time.RFC3339)
	}
	if st.Detail == "" {
		st.Detail = stageDetail[strings.Split(stage, ":")[0]]
	}
	all[stage] = st
	p.Store.SaveStage(id, "stats", 1, all)
}

func (r *runState) counts(stage string) map[string]int {
	name, _, _ := strings.Cut(stage, ":")
	switch name {
	case "ingest":
		return map[string]int{"width": r.meta.Width, "height": r.meta.Height}
	case "panels":
		return map[string]int{"panels": len(r.panels)}
	case "detect", "order":
		c := map[string]int{"regions": len(r.regions)}
		if name == "detect" {
			for _, reg := range r.regions {
				c[reg.DetClass]++
			}
		}
		return c
	case "ocr":
		c := map[string]int{"panels": len(r.panels)}
		for _, reg := range r.regions {
			if reg.Source != nil && reg.Source.Text != "" {
				c["read"]++
			} else {
				c["empty"]++
			}
		}
		return c
	case "scene":
		if r.scene == nil {
			return nil
		}
		return map[string]int{"characters": len(r.scene.Characters), "notes": len(r.scene.Notes), "speakers": len(r.scene.Speakers)}
	case "clean":
		if r.clean == nil {
			return nil
		}
		c := map[string]int{}
		for _, reg := range r.clean.Regions {
			if reg.Replace {
				c["erased"]++
			} else {
				c["kept"]++
			}
		}
		return c
	case "translate", "review":
		if r.draft != nil && name == "translate" {
			return map[string]int{"bubbles": len(r.draft.Regions)}
		}
		if t, err := r.p.Translation(r.id, r.lang); err == nil {
			return map[string]int{"bubbles": len(t.Regions)}
		}
	}
	return nil
}
