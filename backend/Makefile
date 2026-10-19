ROOT       := /data/dev/comic-translator
GO         ?= /snap/bin/go
ORT_LIB    ?= /data/cache/onnxruntime/onnxruntime-linux-x64-1.29.0/lib/libonnxruntime.so
DATA       ?= $(ROOT)/data
SESSION    := comic-translator-api

export TMPDIR     := $(ROOT)/.tmp
export GOCACHE    := /data/cache/go-build
export GOMODCACHE := /data/cache/go-mod
export GOFLAGS    := -modcacherw
export ORT_LIB

.PHONY: build run tmux vet test

build:
	@mkdir -p $(TMPDIR) bin
	$(GO) build -o bin/server ./cmd/server

run: build
	./bin/server -data $(DATA)

tmux: build
	-tmux kill-session -t $(SESSION) 2>/dev/null
	tmux new-session -d -s $(SESSION) -c $(CURDIR) "make run 2>&1 | tee -a $(TMPDIR)/api.log"

vet:
	$(GO) vet ./...

test:
	$(GO) test ./...
