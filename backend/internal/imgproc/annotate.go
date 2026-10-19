package imgproc

import (
	"image"
	"image/color"
	"image/draw"
	"strconv"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

var (
	labelFace font.Face
	faceOnce  sync.Once
	red       = color.RGBA{230, 0, 0, 255}
)

func face() font.Face {
	faceOnce.Do(func() {
		f, err := opentype.Parse(gobold.TTF)
		if err != nil {
			panic(err)
		}
		labelFace, err = opentype.NewFace(f, &opentype.FaceOptions{Size: 15, DPI: 72, Hinting: font.HintingFull})
		if err != nil {
			panic(err)
		}
	})
	return labelFace
}

type Label struct {
	N   int
	Box image.Rectangle
}

// Annotate draws red numbered boxes onto a copy of img. Boxes are in img coordinates.
func Annotate(img *image.RGBA, labels []Label) *image.RGBA {
	out := Crop(img, img.Bounds())
	for _, l := range labels {
		strokeRect(out, l.Box.Inset(-3), 2, red)
	}
	for _, l := range labels {
		drawTag(out, l.Box.Inset(-3), strconv.Itoa(l.N))
	}
	return out
}

func strokeRect(img *image.RGBA, r image.Rectangle, t int, c color.RGBA) {
	r = r.Intersect(img.Bounds())
	u := image.NewUniform(c)
	for _, s := range []image.Rectangle{
		image.Rect(r.Min.X, r.Min.Y, r.Max.X, r.Min.Y+t),
		image.Rect(r.Min.X, r.Max.Y-t, r.Max.X, r.Max.Y),
		image.Rect(r.Min.X, r.Min.Y, r.Min.X+t, r.Max.Y),
		image.Rect(r.Max.X-t, r.Min.Y, r.Max.X, r.Max.Y),
	} {
		draw.Draw(img, s, u, image.Point{}, draw.Src)
	}
}

func drawTag(img *image.RGBA, box image.Rectangle, text string) {
	f := face()
	adv := font.MeasureString(f, text).Ceil()
	m := f.Metrics()
	th := (m.Ascent + m.Descent).Ceil()
	w, h := adv+6, th+2
	x, y := box.Min.X, box.Min.Y-h
	if y < img.Bounds().Min.Y {
		y = box.Min.Y
	}
	x = min(max(x, img.Bounds().Min.X), img.Bounds().Max.X-w)
	tag := image.Rect(x, y, x+w, y+h)
	draw.Draw(img, tag, image.NewUniform(red), image.Point{}, draw.Src)
	d := font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(color.White),
		Face: f,
		Dot:  fixed.P(x+3, y+1+m.Ascent.Ceil()),
	}
	d.DrawString(text)
}
