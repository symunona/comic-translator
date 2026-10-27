set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()

default:
    @just --list

# dev: hub :4750 + vite :4721 in tmux (comic-hub / comic-translator-web)
serve:
    {{root}}/dev.sh

# stop dev tmux sessions
stop:
    -tmux kill-session -t comic-hub
    -tmux kill-session -t comic-translator-web

# build frontend dist + hub binary
build:
    cd {{root}}/frontend && TMPDIR={{root}}/.tmp pnpm build
    make -C {{root}}/hub build

# typecheck + vet + hub tests
check:
    cd {{root}}/frontend && pnpm exec tsc --noEmit
    make -C {{root}}/hub vet test

# build, ship to server, restart comic.tmpx.space
deploy:
    {{root}}/deploy/deploy.sh

# tail prod logs on server
logs:
    ssh server journalctl --user -u comic-hub -f -n 50

# prod service status
status:
    ssh server systemctl --user status comic-hub --no-pager
