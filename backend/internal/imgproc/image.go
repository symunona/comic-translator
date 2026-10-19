package imgproc

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

var formats = map[string]struct {
	ext    string
	decode func([]byte) (image.Image, error)
}{
	"image/png":  {"png", func(b []byte) (image.Image, error) { return png.Decode(bytes.NewReader(b)) }},
	"image/jpeg": {"jpg", func(b []byte) (image.Image, error) { return jpeg.Decode(bytes.NewReader(b)) }},
	"image/webp": {"webp", func(b []byte) (image.Image, error) { return webp.Decode(bytes.NewReader(b)) }},
}

// Decode sniffs the format and returns the image as opaque RGBA plus mime and extension.
func Decode(data []byte) (*image.RGBA, string, string, error) {
	mime := http.DetectContentType(data)
	f, ok := formats[mime]
	if !ok {
		return nil, "", "", fmt.Errorf("unsupported image type %q", mime)
	}
	img, err := f.decode(data)
	if err != nil {
		return nil, "", "", err
	}
	return ToRGBA(img), mime, f.ext, nil
}

func ToRGBA(img image.Image) *image.RGBA {
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Over)
	return dst
}

func Load(path string) (*image.RGBA, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		return nil, err
	}
	return ToRGBA(img), nil
}

func EncodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func Crop(img *image.RGBA, r image.Rectangle) *image.RGBA {
	r = r.Intersect(img.Bounds())
	dst := image.NewRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	draw.Draw(dst, dst.Bounds(), img, r.Min, draw.Src)
	return dst
}

func Scale(img image.Image, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), xdraw.Src, nil)
	return dst
}

func luma(c color.RGBA) uint8 {
	return uint8((299*int(c.R) + 587*int(c.G) + 114*int(c.B)) / 1000)
}

func Luma(img *image.RGBA, x, y int) uint8 { return luma(img.RGBAAt(x, y)) }
