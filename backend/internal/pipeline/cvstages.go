package pipeline

import (
	"context"
	"fmt"
	"image"
	"os"
	"sort"
	"time"

	"comic-translator/backend/internal/detect"
	"comic-translator/backend/internal/imgproc"
)

const (
	minScore        = 0.35
	nmsIoU          = 0.5
	containedRatio  = 0.9
	bubbleShrink    = 0.12
	rowOverlap      = 0.5
	cropPad         = 6
	cropMinHeight   = 120
	cropMaxUpscale  = 3
	debugCropsDir   = "debug/crops"
	overlaysDir     = "overlays"
	textBubbleClass = "text_bubble"
	textFreeClass   = "text_free"
	bubbleClass     = "bubble"
)

func (r *runState) runPanels(ctx context.Context) error {
	img, err := r.image()
	if err != nil {
		return err
	}
	rects := imgproc.Panels(img)
	if len(rects) == 0 {
		rects = []image.Rectangle{img.Bounds()}
	}
	r.panels = make([]Panel, len(rects))
	for i, rect := range rects {
		r.panels[i] = Panel{ID: fmt.Sprintf("p%d", i), Order: i, BBox: BoxOf(rect)}
	}
	return r.p.Store.SaveStage(r.id, "panels", vPanels, r.panels)
}

func (r *runState) runDetect(ctx context.Context) error {
	img, err := r.image()
	if err != nil {
		return err
	}
	r.regions = nil
	for i, panel := range r.panels {
		if err := ctx.Err(); err != nil {
			return err
		}
		rect := panel.BBox.Rect()
		dets, err := r.p.Detector.Detect(imgproc.Crop(img, rect), minScore)
		if err != nil {
			return err
		}
		for j := range dets {
			dets[j].Box = dets[j].Box.Add(rect.Min)
		}
		for _, reg := range panelRegions(dets) {
			reg.PanelID = panel.ID
			reg.ID = fmt.Sprintf("d%d", len(r.regions))
			r.regions = append(r.regions, reg)
		}
		r.stage("detect", StatusRunning, "", &Progress{Done: i + 1, Total: len(r.panels)})
	}
	return r.p.Store.SaveStage(r.id, "detect", vDetect, r.regions)
}

func panelRegions(dets []detect.Detection) []Region {
	byClass := map[string][]detect.Detection{}
	for _, d := range dets {
		byClass[d.Class] = append(byClass[d.Class], d)
	}
	bubbles := nms(byClass[bubbleClass])
	texts := append(nms(byClass[textBubbleClass]), nms(byClass[textFreeClass])...)
	texts = dropContained(nms(texts))

	var regions []Region
	inBubble := map[int]int{}
	for _, t := range texts {
		bi := smallestContaining(bubbles, center(t.Box))
		if k, ok := inBubble[bi]; ok && bi >= 0 {
			merged := regions[k].TextBox.Rect().Union(t.Box)
			regions[k].TextBox = BoxOf(merged)
			continue
		}
		reg := Region{DetClass: t.Class, Score: round2(t.Score), TextBox: BoxOf(t.Box)}
		if bi >= 0 {
			b := BoxOf(bubbles[bi].Box)
			reg.BubbleBox = &b
			inBubble[bi] = len(regions)
		}
		regions = append(regions, reg)
	}
	for i, b := range bubbles {
		if _, ok := inBubble[i]; ok {
			continue
		}
		bb := BoxOf(b.Box)
		regions = append(regions, Region{
			DetClass: bubbleClass, Score: round2(b.Score),
			TextBox: BoxOf(shrink(b.Box, bubbleShrink)), BubbleBox: &bb,
		})
	}
	return regions
}

// nms keeps the highest scoring box among overlapping ones.
func nms(dets []detect.Detection) []detect.Detection {
	sort.Slice(dets, func(i, j int) bool { return dets[i].Score > dets[j].Score })
	var keep []detect.Detection
	for _, d := range dets {
		ok := true
		for _, k := range keep {
			if iou(d.Box, k.Box) > nmsIoU {
				ok = false
				break
			}
		}
		if ok {
			keep = append(keep, d)
		}
	}
	return keep
}

func dropContained(dets []detect.Detection) []detect.Detection {
	var keep []detect.Detection
	for i, d := range dets {
		inside := false
		for j, o := range dets {
			if i != j && o.Class == d.Class && area(o.Box) > area(d.Box) && area(d.Box.Intersect(o.Box)) > containedRatio*area(d.Box) {
				inside = true
				break
			}
		}
		if !inside {
			keep = append(keep, d)
		}
	}
	return keep
}

func smallestContaining(dets []detect.Detection, p image.Point) int {
	best := -1
	for i, d := range dets {
		if p.In(d.Box) && (best < 0 || area(d.Box) < area(dets[best].Box)) {
			best = i
		}
	}
	return best
}

func area(r image.Rectangle) float64 {
	if r.Empty() {
		return 0
	}
	return float64(r.Dx() * r.Dy())
}

func iou(a, b image.Rectangle) float64 {
	inter := area(a.Intersect(b))
	union := area(a) + area(b) - inter
	if union == 0 {
		return 0
	}
	return inter / union
}

func center(r image.Rectangle) image.Point {
	return image.Pt((r.Min.X+r.Max.X)/2, (r.Min.Y+r.Max.Y)/2)
}

func shrink(r image.Rectangle, f float64) image.Rectangle {
	dx, dy := int(float64(r.Dx())*f/2), int(float64(r.Dy())*f/2)
	return image.Rect(r.Min.X+dx, r.Min.Y+dy, r.Max.X-dx, r.Max.Y-dy)
}

func round2(f float32) float64 { return float64(int(f*100+0.5)) / 100 }

func (r *runState) runOrder(ctx context.Context) error {
	byPanel := map[string][]Region{}
	for _, reg := range r.regions {
		byPanel[reg.PanelID] = append(byPanel[reg.PanelID], reg)
	}
	var ordered []Region
	for _, panel := range r.panels {
		for _, reg := range readingOrder(byPanel[panel.ID]) {
			reg.Order = len(ordered)
			reg.ID = fmt.Sprintf("r%d", reg.Order)
			ordered = append(ordered, reg)
		}
	}
	r.regions = ordered
	if err := r.writeDebugImages(); err != nil {
		return err
	}
	return r.p.Store.SaveStage(r.id, "order", vOrder, r.regions)
}

func readingOrder(regs []Region) []Region {
	sort.SliceStable(regs, func(i, j int) bool { return regs[i].TextBox[1] < regs[j].TextBox[1] })
	var rows [][]Region
	for _, reg := range regs {
		if n := len(rows); n > 0 && verticalOverlap(rows[n-1][0].TextBox, reg.TextBox) > rowOverlap {
			rows[n-1] = append(rows[n-1], reg)
			continue
		}
		rows = append(rows, []Region{reg})
	}
	var out []Region
	for _, row := range rows {
		sort.SliceStable(row, func(i, j int) bool { return row[i].TextBox[0] < row[j].TextBox[0] })
		out = append(out, row...)
	}
	return out
}

func verticalOverlap(a, b Box) float64 {
	top, bottom := max(a[1], b[1]), min(a[1]+a[3], b[1]+b[3])
	h := min(a[3], b[3])
	if bottom <= top || h <= 0 {
		return 0
	}
	return float64(bottom-top) / float64(h)
}

func (r *runState) debugPath(pid string) string {
	return r.p.Store.Path(r.id, "debug", pid+".png")
}

func (r *runState) cropPath(rid string) string {
	return r.p.Store.Path(r.id, debugCropsDir, rid+".png")
}

func (r *runState) ensureDebugImages() error {
	for _, panel := range r.panels {
		if _, err := os.Stat(r.debugPath(panel.ID)); err != nil {
			return r.writeDebugImages()
		}
	}
	return nil
}

func (r *runState) writeDebugImages() error {
	img, err := r.image()
	if err != nil {
		return err
	}
	for _, panel := range r.panels {
		rect := panel.BBox.Rect()
		crop := imgproc.Crop(img, rect)
		var labels []imgproc.Label
		for _, reg := range r.regions {
			if reg.PanelID == panel.ID {
				labels = append(labels, imgproc.Label{N: reg.Order, Box: reg.TextBox.Rect().Sub(rect.Min)})
			}
		}
		if err := r.writePNG("debug/"+panel.ID+".png", imgproc.Annotate(crop, labels)); err != nil {
			return err
		}
	}
	for _, reg := range r.regions {
		rect := reg.TextBox.Rect().Inset(-cropPad)
		crop := imgproc.Crop(img, rect)
		h := crop.Bounds().Dy()
		if h > 0 && h < cropMinHeight {
			f := min(float64(cropMinHeight)/float64(h), cropMaxUpscale)
			crop = imgproc.Scale(crop, int(float64(crop.Bounds().Dx())*f), int(float64(h)*f))
		}
		if err := r.writePNG(debugCropsDir+"/"+reg.ID+".png", crop); err != nil {
			return err
		}
	}
	return nil
}

func (r *runState) writePNG(rel string, img image.Image) error {
	data, err := imgproc.EncodePNG(img)
	if err != nil {
		return err
	}
	return r.p.Store.WriteFile(r.id, rel, data)
}

func (r *runState) runClean(ctx context.Context) error {
	img, err := r.image()
	if err != nil {
		return err
	}
	res, err := r.p.erase(r.id, img, r.regions)
	if err != nil {
		return err
	}
	r.clean = res
	return nil
}

// erase writes clean.png and overlays for every region with replace=true and
// saves the clean stage.
func (p *Pipeline) erase(id string, orig *image.RGBA, regions []Region) (*cleanResult, error) {
	clean := imgproc.Crop(orig, orig.Bounds())
	erased := map[string]imgproc.Erased{}
	for _, reg := range regions {
		if reg.Replace {
			erased[reg.ID] = imgproc.Erase(clean, reg.TextBox.Rect(), reg.bubbleRect())
		}
	}
	data, err := imgproc.EncodePNG(clean)
	if err != nil {
		return nil, err
	}
	if err := p.Store.WriteFile(id, "clean.png", data); err != nil {
		return nil, err
	}
	os.RemoveAll(p.Store.Path(id, overlaysDir))
	res := &cleanResult{Rev: time.Now().UnixMilli()}
	for _, reg := range regions {
		reg.OverlayBox, reg.OverlayURL, reg.FitBox, reg.GlyphHeight = nil, "", nil, 0
		if e, ok := erased[reg.ID]; ok && !e.Changed.Empty() {
			a := e.Changed
			limit := reg.bubbleRect()
			if limit.Empty() {
				limit = imgproc.EraseArea(reg.TextBox.Rect(), limit, clean.Bounds())
			}
			if fit := imgproc.FitBox(clean, e.Pixels, limit, reg.TextBox.Rect()); !fit.Empty() {
				b := BoxOf(fit)
				reg.FitBox = &b
			}
			reg.GlyphHeight = e.GlyphHeight
			data, err := imgproc.EncodePNG(imgproc.Crop(clean, a))
			if err != nil {
				return nil, err
			}
			if err := p.Store.WriteFile(id, overlaysDir+"/"+reg.ID+".png", data); err != nil {
				return nil, err
			}
			b := BoxOf(a)
			reg.OverlayBox = &b
			reg.OverlayURL = fmt.Sprintf("%s?v=%d", ImageURL(id, overlaysDir+"/"+reg.ID+".png"), res.Rev)
		}
		res.Regions = append(res.Regions, reg)
	}
	return res, p.Store.SaveStage(id, "clean", vClean, res)
}
