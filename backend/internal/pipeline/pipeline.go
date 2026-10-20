package pipeline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"log"
	"path/filepath"
	"sync"
	"time"

	"comic-translator/backend/internal/detect"
	"comic-translator/backend/internal/imgproc"
	"comic-translator/backend/internal/llm"
	"comic-translator/backend/internal/store"
)

const (
	vPanels    = 1
	vDetect    = 2
	vOrder     = 1
	vOCR       = 1
	vScene     = 1
	vClean     = 5
	vTranslate = 1
	vReview    = 1
)

var SharedStages = []string{"ingest", "panels", "detect", "order", "ocr", "scene", "clean"}

type Pipeline struct {
	Store    store.Store
	Detector *detect.Detector
	LLM      llm.LLM
	// OCRPerPanel sends one OCR request per panel. Default is one request for
	// the whole strip: as accurate in the bench (docs/ocr-bench.md) and cheaper.
	OCRPerPanel bool

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func New(s store.Store, d *detect.Detector, l llm.LLM) *Pipeline {
	return &Pipeline{Store: s, Detector: d, LLM: l, locks: map[string]*sync.Mutex{}}
}

func (p *Pipeline) lock(key string) func() {
	p.mu.Lock()
	m, ok := p.locks[key]
	if !ok {
		m = &sync.Mutex{}
		p.locks[key] = m
	}
	p.mu.Unlock()
	m.Lock()
	return m.Unlock
}

func ImageURL(id, name string) string { return fmt.Sprintf("/api/strips/%s/image/%s", id, name) }

// Ingest stores the upload under its content hash. Existing strips are left untouched.
func (p *Pipeline) Ingest(data []byte, name, srcLang string) (string, bool, error) {
	sum := sha256.Sum256(data)
	id := hex.EncodeToString(sum[:])
	defer p.lock(id)()
	if p.Store.Has(id) {
		return id, true, nil
	}
	img, mime, ext, err := imgproc.Decode(data)
	if err != nil {
		return "", false, err
	}
	if err := p.Store.WriteFile(id, "orig."+ext, data); err != nil {
		return "", false, err
	}
	if ext != "png" {
		norm, err := imgproc.EncodePNG(img)
		if err != nil {
			return "", false, err
		}
		if err := p.Store.WriteFile(id, "orig.png", norm); err != nil {
			return "", false, err
		}
	}
	meta := store.Meta{
		ID: id, OrigName: filepath.Base(name), CreatedAt: time.Now().UTC(),
		Width: img.Bounds().Dx(), Height: img.Bounds().Dy(), Mime: mime, SrcLang: srcLang,
	}
	return id, false, p.Store.SaveMeta(meta)
}

type stage struct {
	name    string
	load    func() (bool, error)
	run     func(ctx context.Context) error
	publish func()
	streams bool
	leaf    bool
}

type runState struct {
	p    *Pipeline
	id   string
	lang string
	emit func(Event)

	meta    store.Meta
	img     *image.RGBA
	panels  []Panel
	regions []Region
	scene   *Scene
	clean   *cleanResult
	draft   *Translation
	meter   *llm.Meter
}

func (r *runState) stage(name, status, msg string, prog *Progress) {
	r.emit(Event{"stage", StageEvent{Stage: name, Status: status, Message: msg, Progress: prog}})
}

func (r *runState) data(kind string, payload any) {
	r.emit(Event{"data", DataEvent{Kind: kind, Payload: payload}})
}

func (r *runState) image() (*image.RGBA, error) {
	if r.img == nil {
		img, err := imgproc.Load(r.p.Store.Path(r.id, "orig.png"))
		if err != nil {
			return nil, err
		}
		r.img = img
	}
	return r.img, nil
}

func (r *runState) llmCtx(ctx context.Context, stage, name string) context.Context {
	ctx = llm.WithStage(llm.WithLog(ctx, r.p.Store.Path(r.id, "llm"), name), stage)
	if r.meter != nil {
		ctx = llm.WithMeter(ctx, r.meter)
	}
	return ctx
}

// Run executes every stage for (id, lang), reusing cached stage outputs until
// the first stage that has to be recomputed; every later stage then reruns,
// except after leaf stages that nothing downstream reads.
func (p *Pipeline) Run(ctx context.Context, id, lang string, emit func(Event)) error {
	meta, err := p.Store.Meta(id)
	if err != nil {
		return fmt.Errorf("unknown strip %s", id)
	}
	r := &runState{p: p, id: id, lang: lang, emit: emit, meta: meta}
	r.stage("ingest", StatusCached, "", nil)
	r.data("meta", MetaPayload{ID: id, OrigName: meta.OrigName, Width: meta.Width, Height: meta.Height, ImageURL: ImageURL(id, "orig.png")})

	dirty := false
	unlock := p.lock(id)
	err = r.runStages(ctx, r.sharedStages(), &dirty)
	unlock()
	if err != nil {
		return err
	}
	defer p.lock(id + "/" + lang)()
	return r.runStages(ctx, r.langStages(), &dirty)
}

func (r *runState) runStages(ctx context.Context, stages []stage, dirty *bool) error {
	for _, s := range stages {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !*dirty {
			ok, err := s.load()
			if err != nil {
				log.Printf("%s %s: cache load: %v", r.id[:8], s.name, err)
			}
			if ok && err == nil {
				r.stage(s.name, StatusCached, "", nil)
				s.publish()
				continue
			}
		}
		if !s.leaf {
			*dirty = true
		}
		r.stage(s.name, StatusRunning, "", nil)
		start := time.Now()
		if err := s.run(ctx); err != nil {
			r.stage(s.name, StatusError, err.Error(), nil)
			return fmt.Errorf("%s: %w", s.name, err)
		}
		if !s.streams {
			s.publish()
		}
		took := time.Since(start)
		r.p.recordStat(r.id, s.name, StageStat{Ms: took.Milliseconds(), Where: "server", Counts: r.counts(s.name)})
		r.stage(s.name, StatusDone, took.Round(time.Millisecond).String(), nil)
	}
	return nil
}

func (r *runState) sharedStages() []stage {
	s := r.p.Store
	return []stage{
		{
			name:    "panels",
			load:    func() (bool, error) { return s.LoadStage(r.id, "panels", vPanels, &r.panels) },
			run:     r.runPanels,
			publish: func() { r.data("panels", r.panels) },
		},
		{
			name:    "detect",
			load:    func() (bool, error) { return s.LoadStage(r.id, "detect", vDetect, &r.regions) },
			run:     r.runDetect,
			publish: func() { r.data("regions", r.regions) },
		},
		{
			name: "order",
			load: func() (bool, error) {
				ok, err := s.LoadStage(r.id, "order", vOrder, &r.regions)
				if ok && err == nil {
					err = r.ensureDebugImages()
				}
				return ok, err
			},
			run:     r.runOrder,
			publish: func() { r.data("regions", r.regions) },
		},
		{
			name:    "ocr",
			load:    func() (bool, error) { return s.LoadStage(r.id, "ocr", vOCR, &r.regions) },
			run:     r.runOCR,
			publish: func() { r.publishRegions() },
			streams: true,
		},
		{
			name: "scene",
			load: func() (bool, error) {
				r.scene = &Scene{}
				return s.LoadStage(r.id, "scene", vScene, r.scene)
			},
			run: r.runScene,
			publish: func() {
				r.applySpeakers()
				r.data("scene", r.scene)
			},
		},
		{
			name: "clean",
			load: func() (bool, error) {
				r.clean = &cleanResult{}
				return s.LoadStage(r.id, "clean", vClean, r.clean)
			},
			run:     r.runClean,
			publish: func() { r.data("overlays", r.clean.Regions) },
			leaf:    true,
		},
	}
}

func (r *runState) langStages() []stage {
	s := r.p.Store
	tname, rname := "translate:"+r.lang, "review:"+r.lang
	return []stage{
		{
			name: tname,
			load: func() (bool, error) {
				r.draft = &Translation{}
				return s.LoadStage(r.id, tname, vTranslate, r.draft)
			},
			run:     r.runTranslate,
			publish: func() { r.data("translation", r.draft) },
		},
		{
			name: rname,
			load: func() (bool, error) {
				var t Translation
				return s.LoadTranslation(r.id, r.lang, vReview, &t)
			},
			run: r.runReview,
			publish: func() {
				if t, err := r.p.Translation(r.id, r.lang); err == nil {
					r.data("translation", t)
				}
			},
		},
	}
}

func (r *runState) publishRegions() {
	for _, reg := range r.regions {
		r.data("region", reg)
	}
}
