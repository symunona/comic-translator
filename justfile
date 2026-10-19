set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()

default:
    @just --list

# dev: API :4720 + vite :4721 in tmux (comic-translator-api / -web)
serve:
    {{root}}/dev.sh

# stop dev tmux sessions
stop:
    -tmux kill-session -t comic-translator-api
    -tmux kill-session -t comic-translator-web

# build frontend dist + backend binary
build:
    cd {{root}}/frontend && TMPDIR={{root}}/.tmp pnpm build
    make -C {{root}}/backend build

# typecheck + vet
check:
    cd {{root}}/frontend && pnpm exec tsc --noEmit
    make -C {{root}}/backend vet

# build, ship to server, restart comic.tmpx.space
deploy:
    {{root}}/deploy/deploy.sh

# tail prod logs on server
logs:
    ssh server journalctl --user -u comic-translator -f -n 50

# prod service status
status:
    ssh server systemctl --user status comic-translator --no-pager

# browser-offload env: build, ship to server ~/comic-browser, restart comic-browser.tmpx.space
deploy-browser:
    {{root}}/deploy/browser.sh

# tail browser-offload env logs on server
logs-browser:
    ssh server journalctl --user -u comic-browser -f -n 50
