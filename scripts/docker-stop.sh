#!/usr/bin/env sh
set -eu

docker compose stop reloops
docker compose run --rm --no-deps --entrypoint sh reloops -c 'supabase stop --workdir "$RELOOPS_BACKEND_DIR"'
docker compose down
