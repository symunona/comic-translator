package imgproc

import (
	"image"
	"image/color"
	"sort"
)

const (
	erasePad       = 6
	eraseReach     = 24
	eraseBubbleTol = 8
	eraseInk       = 160
	eraseDilate    = 2
	eraseTallRatio = 3
	encloseRatio   = 0.9
)

// EraseArea is the work area for a text box: padded text box clipped to the bubble.
func EraseArea(text, bubble, bounds image.Rectangle) image.Rectangle {
	a := text.Inset(-erasePad)
	if !bubble.Empty() {
		a = a.Intersect(bubble)
	}
	return a.Intersect(bounds)
}

// searchArea is where components are traced: wide enough that letters the
// detector clipped are seen whole, still bounded by the bubble.
func searchArea(text, bubble, bounds image.Rectangle) image.Rectangle {
	s := text.Inset(-eraseReach)
	if !bubble.Empty() {
		s = s.Intersect(bubble.Inset(-eraseBubbleTol))
	}
	return s.Intersect(bounds)
}

type component struct {
	pixels       []image.Point
	box          image.Rectangle
	touchesFrame bool
}

type Erased struct {
	Changed     image.Rectangle
	Pixels      []image.Point
	GlyphHeight int
}

// Erase removes the lettering of one text region in place and reports the
// rectangle that changed (at least the work area), the painted pixels and the
// median letter height. Ink components count as
// lettering when they reach into the work area, do not touch the search frame
// (bubble outline, tail, art), are not unusually tall (3x the 75th percentile
// height, so accents and dots do not drag the reference down) and do not
// enclose the text (nested bubble outlines). They are dilated and painted with the paper
// colour; pixels of rejected components are never painted.
func Erase(img *image.RGBA, text, bubble image.Rectangle) Erased {
	a := EraseArea(text, bubble, img.Bounds())
	s := searchArea(text, bubble, img.Bounds()).Union(a)
	if a.Empty() {
		return Erased{Changed: a}
	}
	w, h := s.Dx(), s.Dy()
	ink := make([]bool, w*h)
	var paper []int
	for y := range h {
		for x := range w {
			l := Luma(img, s.Min.X+x, s.Min.Y+y)
			if l < eraseInk {
				ink[y*w+x] = true
			} else if image.Pt(s.Min.X+x, s.Min.Y+y).In(a) {
				paper = append(paper, int(l))
			}
		}
	}
	local := a.Sub(s.Min)
	var cands []component
	var heights []int
	keep := make([]bool, w*h)
	for _, c := range components(ink, w, h) {
		if !c.touchesFrame && c.box.Overlaps(local) && !encloses(c.box, local) {
			cands = append(cands, c)
			heights = append(heights, c.box.Dy())
			continue
		}
		for _, p := range c.pixels {
			keep[p.Y*w+p.X] = true
		}
	}
	if len(cands) == 0 {
		return Erased{Changed: a}
	}
	sort.Ints(heights)
	limit := heights[len(heights)*3/4] * eraseTallRatio
	res := Erased{Changed: a, GlyphHeight: glyphHeight(heights, limit)}

	mask := make([]bool, w*h)
	for _, c := range cands {
		if c.box.Dy() > limit {
			for _, p := range c.pixels {
				keep[p.Y*w+p.X] = true
			}
			continue
		}
		for _, p := range c.pixels {
			for dy := -eraseDilate; dy <= eraseDilate; dy++ {
				for dx := -eraseDilate; dx <= eraseDilate; dx++ {
					x, y := p.X+dx, p.Y+dy
					if x >= 0 && y >= 0 && x < w && y < h {
						mask[y*w+x] = true
					}
				}
			}
		}
	}

	fill := color.RGBA{255, 255, 255, 255}
	if len(paper) > 0 {
		sort.Ints(paper)
		v := uint8(paper[len(paper)/2])
		fill = color.RGBA{v, v, v, 255}
	}
	for y := range h {
		for x := range w {
			if mask[y*w+x] && !keep[y*w+x] {
				p := image.Pt(s.Min.X+x, s.Min.Y+y)
				img.SetRGBA(p.X, p.Y, fill)
				res.Pixels = append(res.Pixels, p)
				res.Changed = res.Changed.Union(image.Rect(p.X, p.Y, p.X+1, p.Y+1))
			}
		}
	}
	return res
}

// glyphHeight is the median height of letter-sized components: accents, dots
// and punctuation (under half the 75th percentile) and oversized ink are skipped.
func glyphHeight(sorted []int, limit int) int {
	floor := sorted[len(sorted)*3/4] / 2
	var letters []int
	for _, h := range sorted {
		if h >= floor && h <= limit {
			letters = append(letters, h)
		}
	}
	if len(letters) == 0 {
		return 0
	}
	return letters[len(letters)/2]
}

func encloses(box, area image.Rectangle) bool {
	return float64(box.Dx()) > encloseRatio*float64(area.Dx()) && float64(box.Dy()) > encloseRatio*float64(area.Dy())
}

func components(ink []bool, w, h int) []component {
	seen := make([]bool, len(ink))
	var comps []component
	var stack []image.Point
	for start := range ink {
		if !ink[start] || seen[start] {
			continue
		}
		var c component
		seen[start] = true
		stack = append(stack[:0], image.Pt(start%w, start/w))
		for len(stack) > 0 {
			p := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			c.pixels = append(c.pixels, p)
			c.box = c.box.Union(image.Rect(p.X, p.Y, p.X+1, p.Y+1))
			if p.X == 0 || p.Y == 0 || p.X == w-1 || p.Y == h-1 {
				c.touchesFrame = true
			}
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					x, y := p.X+dx, p.Y+dy
					if x < 0 || y < 0 || x >= w || y >= h {
						continue
					}
					if i := y*w + x; ink[i] && !seen[i] {
						seen[i] = true
						stack = append(stack, image.Pt(x, y))
					}
				}
			}
		}
		comps = append(comps, c)
	}
	return comps
}
