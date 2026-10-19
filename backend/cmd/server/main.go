package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"comic-translator/backend/internal/api"
	"comic-translator/backend/internal/detect"
	"comic-translator/backend/internal/llm"
	"comic-translator/backend/internal/pipeline"
	"comic-translator/backend/internal/store"
)

const (
	defaultORT   = "/data/cache/onnxruntime/onnxruntime-linux-x64-1.29.0/lib/libonnxruntime.so"
	defaultModel = "/data/cache/models/comic-detector/detector.onnx"
	defaultData  = "/data/dev/comic-translator/data"
	defaultTmp   = "/data/dev/comic-translator/.tmp"
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(filepath.Join(dir, filepath.Clean("/"+r.URL.Path))); err != nil {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
}

func main() {
	addr := flag.String("addr", "127.0.0.1:4720", "listen address")
	dataDir := flag.String("data", defaultData, "data directory")
	model := flag.String("model", "opus", "claude model for ocr/scene/translate/review")
	detModel := flag.String("detector", defaultModel, "detector onnx path")
	claudeBin := flag.String("claude", "claude", "claude CLI binary")
	concurrency := flag.Int("llm-concurrency", 4, "max concurrent LLM calls")
	threads := flag.Int("ort-threads", 0, "onnxruntime intra-op threads (0 = default)")
	static := flag.String("static", "", "serve built frontend from this dir (SPA fallback to index.html)")
	flag.Parse()

	tmp := envOr("TMPDIR", defaultTmp)
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		log.Fatal(err)
	}
	st, err := store.NewFS(*dataDir)
	if err != nil {
		log.Fatal(err)
	}
	det, err := detect.New(envOr("ORT_LIB", defaultORT), *detModel, *threads)
	if err != nil {
		log.Fatal(err)
	}
	defer det.Close()
	cli := llm.NewClaudeCLI(*claudeBin, *model, st.Root(), tmp, *concurrency)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	p := pipeline.New(st, det, cli)
	var handler http.Handler = (&api.Server{P: p, Jobs: pipeline.NewJobs(ctx, p)}).Handler()
	if *static != "" {
		mux := http.NewServeMux()
		mux.Handle("/api/", handler)
		mux.Handle("/", spa(*static))
		handler = mux
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Printf("comic-translator api on http://%s data=%s model=%s", *addr, st.Root(), *model)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
