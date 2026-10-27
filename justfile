set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load

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

# build, ship to $DEPLOY_HOST, restart the hub
deploy:
    {{root}}/deploy/deploy.sh

# tail prod logs on $DEPLOY_HOST
logs:
    ssh "$DEPLOY_HOST" journalctl --user -u comic-hub -f -n 50

# prod service status
status:
    ssh "$DEPLOY_HOST" systemctl --user status comic-hub --no-pager
