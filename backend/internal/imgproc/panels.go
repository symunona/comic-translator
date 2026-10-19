package imgproc

import "image"

const (
	panelInk     = 128
	speckArea    = 2
	panelMinGap  = 12
	panelMinSize = 60
	panelPad     = 4
)

type inkMap struct {
	w, h int
	ink  []bool
}

func newInkMap(img *image.RGBA, threshold uint8) *inkMap {
	b := img.Bounds()
	m := &inkMap{w: b.Dx(), h: b.Dy(), ink: make([]bool, b.Dx()*b.Dy())}
	for y := 0; y < m.h; y++ {
		for x := 0; x < m.w; x++ {
			m.ink[y*m.w+x] = Luma(img, b.Min.X+x, b.Min.Y+y) < threshold
		}
	}
	return m
}

// despeckle clears small isolated ink blobs (dust, scan noise).
func (m *inkMap) despeckle(maxArea int) {
	for _, c := range components(m.ink, m.w, m.h) {
		if len(c.pixels) <= maxArea {
			for _, p := range c.pixels {
				m.ink[p.Y*m.w+p.X] = false
			}
		}
	}
}

func (m *inkMap) at(x, y int) bool { return m.ink[y*m.w+x] }

func (m *inkMap) profile(r image.Rectangle, rows bool) []bool {
	n, across := r.Dx(), r.Dy()
	if rows {
		n, across = r.Dy(), r.Dx()
	}
	filled := make([]bool, n)
	for i := range n {
		for j := 0; j < across && !filled[i]; j++ {
			x, y := r.Min.X+i, r.Min.Y+j
			if rows {
				x, y = r.Min.X+j, r.Min.Y+i
			}
			filled[i] = m.at(x, y)
		}
	}
	return filled
}

func (m *inkMap) trim(r image.Rectangle) image.Rectangle {
	rows, cols := m.profile(r, true), m.profile(r, false)
	y0, y1, okY := span(rows)
	x0, x1, okX := span(cols)
	if !okY || !okX {
		return image.Rectangle{}
	}
	return image.Rect(r.Min.X+x0, r.Min.Y+y0, r.Min.X+x1, r.Min.Y+y1)
}

func span(filled []bool) (int, int, bool) {
	lo, hi := -1, -1
	for i, f := range filled {
		if f {
			if lo < 0 {
				lo = i
			}
			hi = i + 1
		}
	}
	return lo, hi, lo >= 0
}

// segments returns [start,end) runs separated by blank gaps of at least panelMinGap.
func segments(filled []bool) [][2]int {
	var out [][2]int
	start, gap := -1, 0
	for i, f := range filled {
		if f {
			if start < 0 {
				start = i
			} else if gap >= panelMinGap {
				out = append(out, [2]int{start, i - gap})
				start = i
			}
			gap = 0
		} else if start >= 0 {
			gap++
		}
	}
	if start >= 0 {
		out = append(out, [2]int{start, len(filled) - gap})
	}
	return out
}

// Panels splits a strip into panels by recursive XY-cut on the ink projection.
func Panels(img *image.RGBA) []image.Rectangle {
	m := newInkMap(img, panelInk)
	m.despeckle(speckArea)
	var out []image.Rectangle
	var cut func(r image.Rectangle)
	cut = func(r image.Rectangle) {
		r = m.trim(r)
		if r.Empty() {
			return
		}
		for _, rows := range []bool{true, false} {
			segs := segments(m.profile(r, rows))
			if len(segs) < 2 {
				continue
			}
			for _, s := range segs {
				if rows {
					cut(image.Rect(r.Min.X, r.Min.Y+s[0], r.Max.X, r.Min.Y+s[1]))
				} else {
					cut(image.Rect(r.Min.X+s[0], r.Min.Y, r.Min.X+s[1], r.Max.Y))
				}
			}
			return
		}
		if r.Dx() >= panelMinSize && r.Dy() >= panelMinSize {
			out = append(out, r.Inset(-panelPad).Intersect(img.Bounds()))
		}
	}
	cut(img.Bounds())
	return out
}
