ROOT := $(abspath $(CURDIR)/..)
GO   ?= go
CACHE_DIR ?= $(ROOT)/.cache
DATA ?= $(ROOT)/data-hub
SESSION := comic-hub

export TMPDIR     := $(ROOT)/.tmp
export GOCACHE    := $(CACHE_DIR)/go-build
export GOMODCACHE := $(CACHE_DIR)/go-mod
export GOFLAGS    := -modcacherw
export CGO_ENABLED := 0

.PHONY: build run tmux vet test

build:
	@mkdir -p $(TMPDIR) bin
	$(GO) build -trimpath -o bin/hub .

run: build
	./bin/hub -data $(DATA) -models $(CACHE_DIR)/models/comic-detector

tmux: build
	-tmux kill-session -t $(SESSION) 2>/dev/null
	tmux new-session -d -s $(SESSION) -e TURNSTILE_SITE_KEY=$$TURNSTILE_SITE_KEY -e TURNSTILE_SECRET=$$TURNSTILE_SECRET -c $(CURDIR) "make run 2>&1 | tee -a $(TMPDIR)/hub.log"

vet:
	$(GO) vet ./...

test:
	$(GO) test ./...
