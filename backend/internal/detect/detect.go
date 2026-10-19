package detect

import (
	"fmt"
	"image"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
	xdraw "golang.org/x/image/draw"
)

const (
	inputSize = 640
	queries   = 300
)

var Classes = []string{"bubble", "text_bubble", "text_free"}

type Detection struct {
	Class string
	Score float32
	Box   image.Rectangle
}

type Detector struct {
	mu      sync.Mutex
	session *ort.DynamicAdvancedSession
}

func New(libPath, modelPath string, threads int) (*Detector, error) {
	ort.SetSharedLibraryPath(libPath)
	if !ort.IsInitialized() {
		if err := ort.InitializeEnvironment(); err != nil {
			return nil, fmt.Errorf("init onnxruntime (%s): %w", libPath, err)
		}
	}
	opts, err := ort.NewSessionOptions()
	if err != nil {
		return nil, err
	}
	defer opts.Destroy()
	if threads > 0 {
		if err := opts.SetIntraOpNumThreads(threads); err != nil {
			return nil, err
		}
	}
	s, err := ort.NewDynamicAdvancedSession(modelPath,
		[]string{"images", "orig_target_sizes"},
		[]string{"labels", "boxes", "scores"}, opts)
	if err != nil {
		return nil, fmt.Errorf("load detector %s: %w", modelPath, err)
	}
	return &Detector{session: s}, nil
}

func (d *Detector) Close() error { return d.session.Destroy() }

// Detect runs the model on img and returns detections in img pixel coordinates.
func (d *Detector) Detect(img *image.RGBA, minScore float32) ([]Detection, error) {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	scaled := image.NewRGBA(image.Rect(0, 0, inputSize, inputSize))
	xdraw.BiLinear.Scale(scaled, scaled.Bounds(), img, img.Bounds(), xdraw.Src, nil)
	plane := inputSize * inputSize
	pixels := make([]float32, 3*plane)
	for y := range inputSize {
		for x := range inputSize {
			c := scaled.RGBAAt(x, y)
			i := y*inputSize + x
			pixels[i] = float32(c.R) / 255
			pixels[plane+i] = float32(c.G) / 255
			pixels[2*plane+i] = float32(c.B) / 255
		}
	}

	images, err := ort.NewTensor(ort.NewShape(1, 3, inputSize, inputSize), pixels)
	if err != nil {
		return nil, err
	}
	defer images.Destroy()
	sizes, err := ort.NewTensor(ort.NewShape(1, 2), []int64{int64(w), int64(h)})
	if err != nil {
		return nil, err
	}
	defer sizes.Destroy()
	labels, err := ort.NewEmptyTensor[int64](ort.NewShape(1, queries))
	if err != nil {
		return nil, err
	}
	defer labels.Destroy()
	boxes, err := ort.NewEmptyTensor[float32](ort.NewShape(1, queries, 4))
	if err != nil {
		return nil, err
	}
	defer boxes.Destroy()
	scores, err := ort.NewEmptyTensor[float32](ort.NewShape(1, queries))
	if err != nil {
		return nil, err
	}
	defer scores.Destroy()

	d.mu.Lock()
	err = d.session.Run([]ort.Value{images, sizes}, []ort.Value{labels, boxes, scores})
	d.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("detector run: %w", err)
	}

	var out []Detection
	ls, bs, ss := labels.GetData(), boxes.GetData(), scores.GetData()
	for i := range queries {
		if ss[i] < minScore || ls[i] < 0 || int(ls[i]) >= len(Classes) {
			continue
		}
		b := bs[i*4 : i*4+4]
		r := image.Rect(int(b[0]+0.5), int(b[1]+0.5), int(b[2]+0.5), int(b[3]+0.5)).Intersect(image.Rect(0, 0, w, h))
		if r.Empty() {
			continue
		}
		out = append(out, Detection{Class: Classes[ls[i]], Score: ss[i], Box: r})
	}
	return out, nil
}
