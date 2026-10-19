package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"

	"comic-translator/backend/internal/llm"
	"comic-translator/backend/internal/pipeline"
)

const (
	maxUpload = 64 << 20
	maxRender = 128 << 20
)

var (
	idRe    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	langRe  = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z]{2,4})?$`)
	ridRe   = regexp.MustCompile(`^r\d+$`)
	pidRe   = regexp.MustCompile(`^p\d+$`)
	pngSign = []byte("\x89PNG\r\n\x1a\n")
)

type Server struct {
	P            *pipeline.Pipeline
	Jobs         *pipeline.Jobs
	ClientDetect bool
	Debug        bool
	// DetectorModel is the server detector file; unused when ClientDetect.
	DetectorModel string
	LLMStages     map[string]string
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/config", s.config)
	mux.HandleFunc("GET /api/strips", s.list)
	mux.HandleFunc("POST /api/strips", s.upload)
	mux.HandleFunc("GET /api/strips/{id}", s.strip(s.get))
	mux.HandleFunc("GET /api/strips/{id}/events", s.strip(s.events))
	mux.HandleFunc("GET /api/strips/{id}/usage", s.strip(s.usage))
	mux.HandleFunc("GET /api/strips/{id}/panels", s.strip(s.panels))
	mux.HandleFunc("PUT /api/strips/{id}/stages/detect", s.strip(s.putDetect))
	mux.HandleFunc("GET /api/strips/{id}/image/{name}", s.strip(s.image))
	mux.HandleFunc("GET /api/strips/{id}/image/{dir}/{name}", s.strip(s.image))
	mux.HandleFunc("GET /api/strips/{id}/translations/{lang}", s.strip(s.lang(s.getTranslation)))
	mux.HandleFunc("PUT /api/strips/{id}/translations/{lang}", s.strip(s.lang(s.putTranslation)))
	mux.HandleFunc("POST /api/strips/{id}/retranslate/{lang}", s.strip(s.lang(s.retranslate)))
	mux.HandleFunc("POST /api/strips/{id}/render/{lang}", s.strip(s.lang(s.render)))
	mux.HandleFunc("PATCH /api/strips/{id}/regions/{rid}", s.strip(s.patchRegion))
	return logRequests(mux)
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Query().Has("lang") {
			log.Printf("%s %s", r.Method, r.URL.RequestURI())
		}
		h.ServeHTTP(w, r)
	})
}

func (s *Server) strip(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !idRe.MatchString(id) || !s.P.Store.Has(id) {
			httpError(w, http.StatusNotFound, "strip not found")
			return
		}
		h(w, r)
	}
}

func (s *Server) lang(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !langRe.MatchString(r.PathValue("lang")) {
			httpError(w, http.StatusBadRequest, "bad lang")
			return
		}
		h(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func pipelineError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, pipeline.ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, pipeline.ErrBadInput):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, pipeline.ErrNotReady):
		httpError(w, http.StatusConflict, err.Error())
	default:
		httpError(w, http.StatusInternalServerError, err.Error())
	}
}

func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	cfg := map[string]any{"clientDetect": s.ClientDetect, "debug": s.Debug}
	if s.Debug {
		cfg["detector"] = s.DetectorModel
		cfg["llm"] = s.LLMStages
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (s *Server) panels(w http.ResponseWriter, r *http.Request) {
	res, err := s.P.Panels(r.PathValue("id"))
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) putDetect(w http.ResponseWriter, r *http.Request) {
	var in pipeline.ClientDetect
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	regions, err := s.P.SaveClientDetect(r.PathValue("id"), in)
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, regions)
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = min(v, 100)
	}
	out, err := s.P.Summaries(limit)
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	f, hdr, err := r.FormFile("file")
	if err != nil {
		httpError(w, http.StatusBadRequest, "multipart field 'file' required: "+err.Error())
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, existing, err := s.P.Ingest(data, hdr.Filename)
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "existing": existing})
}

func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	st, err := s.P.Strip(r.PathValue("id"))
	if err != nil {
		pipelineError(w, err)
		return
	}
	for k, v := range s.Jobs.Running(st.Meta.ID) {
		st.Stages[k] = v
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) usage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rep, err := s.P.Usage(id)
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		*llm.Report
		Detect *pipeline.DetectRun `json:"detect,omitempty"`
	}{rep, s.P.DetectRun(id)})
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = "en"
	}
	if !langRe.MatchString(lang) {
		httpError(w, http.StatusBadRequest, "bad lang")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	job := s.Jobs.Start(r.PathValue("id"), lang)
	job.Subscribe(r.Context(), func(e pipeline.Event) error {
		data, err := json.Marshal(e.Data)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Name, data); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})
}

func (s *Server) image(w http.ResponseWriter, r *http.Request) {
	id, dir, name := r.PathValue("id"), r.PathValue("dir"), r.PathValue("name")
	var rel string
	switch dir {
	case "":
		if name != "orig.png" && name != "clean.png" {
			httpError(w, http.StatusNotFound, "no such image")
			return
		}
		rel = name
	case "overlays", "debug", "out":
		base, ext := name[:len(name)-len(filepath.Ext(name))], filepath.Ext(name)
		valid := map[string]*regexp.Regexp{"overlays": ridRe, "debug": pidRe, "out": langRe}[dir]
		if ext != ".png" || !valid.MatchString(base) {
			httpError(w, http.StatusNotFound, "no such image")
			return
		}
		rel = filepath.Join(dir, name)
	default:
		httpError(w, http.StatusNotFound, "no such image")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, s.P.Store.Path(id, rel))
}

func (s *Server) getTranslation(w http.ResponseWriter, r *http.Request) {
	t, err := s.P.Translation(r.PathValue("id"), r.PathValue("lang"))
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) putTranslation(w http.ResponseWriter, r *http.Request) {
	var t pipeline.Translation
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&t); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	saved, err := s.P.SaveEdit(r.PathValue("id"), r.PathValue("lang"), t)
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) retranslate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RegionIDs []string `json:"regionIds"`
		Hint      string   `json:"hint"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil && err != io.EOF {
			httpError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	id, lang := r.PathValue("id"), r.PathValue("lang")
	if s.Jobs.Busy(id, lang) {
		httpError(w, http.StatusConflict, "pipeline is running for this language")
		return
	}
	t, err := s.P.Retranslate(r.Context(), id, lang, body.RegionIDs, body.Hint)
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) render(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRender))
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !bytes.HasPrefix(data, pngSign) {
		httpError(w, http.StatusBadRequest, "body must be a PNG")
		return
	}
	id, lang := r.PathValue("id"), r.PathValue("lang")
	if err := s.P.Store.WriteFile(id, "out/"+lang+".png", data); err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": pipeline.ImageURL(id, "out/"+lang+".png")})
}

func (s *Server) patchRegion(w http.ResponseWriter, r *http.Request) {
	rid := r.PathValue("rid")
	if !ridRe.MatchString(rid) {
		httpError(w, http.StatusNotFound, "region not found")
		return
	}
	var patch pipeline.RegionPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&patch); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	reg, err := s.P.PatchRegion(r.PathValue("id"), rid, patch)
	if err != nil {
		pipelineError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, reg)
}
