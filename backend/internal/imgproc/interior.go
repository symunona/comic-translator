package imgproc

import "image"

const fitErode = 4

// FitBox finds where replacement text can go: the paper-coloured region
// reachable from the erased pixels without crossing ink, limited to limit,
// eroded away from the outline, and reduced to its largest inscribed
// axis-aligned rectangle. Of several eroded pieces (outline gaps), the one
// overlapping text most is used.
func FitBox(img *image.RGBA, seeds []image.Point, limit, text image.Rectangle) image.Rectangle {
	l := limit.Intersect(img.Bounds())
	if l.Empty() {
		return image.Rectangle{}
	}
	w, h := l.Dx(), l.Dy()
	paper := make([]bool, w*h)
	for y := range h {
		for x := range w {
			paper[y*w+x] = Luma(img, l.Min.X+x, l.Min.Y+y) >= eraseInk
		}
	}
	var start []int
	for _, p := range seeds {
		if p.In(l) {
			start = append(start, (p.Y-l.Min.Y)*w+p.X-l.Min.X)
		}
	}
	interior := erode(flood(paper, w, h, start), w, h, fitErode)
	piece := bestPiece(interior, w, h, text.Sub(l.Min))
	if piece == nil {
		return image.Rectangle{}
	}
	return maxRect(piece, w, h).Add(l.Min)
}

func flood(open []bool, w, h int, start []int) []bool {
	in := make([]bool, len(open))
	stack := make([]int, 0, len(start))
	for _, i := range start {
		if open[i] && !in[i] {
			in[i] = true
			stack = append(stack, i)
		}
	}
	for len(stack) > 0 {
		i := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		x, y := i%w, i/w
		for _, n := range [4][2]int{{x - 1, y}, {x + 1, y}, {x, y - 1}, {x, y + 1}} {
			if n[0] < 0 || n[1] < 0 || n[0] >= w || n[1] >= h {
				continue
			}
			if j := n[1]*w + n[0]; open[j] && !in[j] {
				in[j] = true
				stack = append(stack, j)
			}
		}
	}
	return in
}

// erode keeps pixels whose (2r+1)² neighbourhood lies entirely inside the
// mask; everything beyond the grid counts as outside.
func erode(m []bool, w, h, r int) []bool {
	return erodePass(erodePass(m, w, h, r, 1, w), w, h, r, w, 1)
}

// erodePass erodes along one axis: step is the index distance between
// neighbours along it, and lines enumerates the perpendicular lines.
func erodePass(m []bool, w, h, r, step, across int) []bool {
	n, lines := w, h
	if step != 1 {
		n, lines = h, w
	}
	out := make([]bool, len(m))
	for line := range lines {
		base := line * across
		run := 0
		for i := range n {
			if m[base+i*step] {
				run++
			} else {
				run = 0
			}
			if run >= 2*r+1 {
				out[base+(i-r)*step] = true
			}
		}
	}
	return out
}

func bestPiece(m []bool, w, h int, text image.Rectangle) []bool {
	text = text.Intersect(image.Rect(0, 0, w, h))
	label := make([]int, len(m))
	var overlap, size []int
	for i := range m {
		if !m[i] || label[i] != 0 {
			continue
		}
		id := len(size) + 1
		piece := flood(m, w, h, []int{i})
		ov, sz := 0, 0
		for j, in := range piece {
			if in {
				label[j] = id
				sz++
				if image.Pt(j%w, j/w).In(text) {
					ov++
				}
			}
		}
		overlap, size = append(overlap, ov), append(size, sz)
	}
	if len(size) == 0 {
		return nil
	}
	best := 0
	for k := range size {
		if overlap[k] > overlap[best] || overlap[k] == overlap[best] && size[k] > size[best] {
			best = k
		}
	}
	out := make([]bool, len(m))
	for i, id := range label {
		out[i] = id == best+1
	}
	return out
}

// maxRect is the largest all-true axis-aligned rectangle (histogram stack method).
func maxRect(m []bool, w, h int) image.Rectangle {
	heights := make([]int, w+1)
	var best image.Rectangle
	area := 0
	stack := make([]int, 0, w+1)
	for y := range h {
		for x := range w {
			if m[y*w+x] {
				heights[x]++
			} else {
				heights[x] = 0
			}
		}
		stack = stack[:0]
		for x := 0; x <= w; x++ {
			for len(stack) > 0 && heights[stack[len(stack)-1]] >= heights[x] {
				top := heights[stack[len(stack)-1]]
				stack = stack[:len(stack)-1]
				left := 0
				if len(stack) > 0 {
					left = stack[len(stack)-1] + 1
				}
				if a := top * (x - left); a > area {
					area = a
					best = image.Rect(left, y+1-top, x, y+1)
				}
			}
			stack = append(stack, x)
		}
	}
	return best
}
