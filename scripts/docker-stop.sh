#!/usr/bin/env sh
set -eu

docker compose run --rm --no-deps reloops sh scripts/supabase-cli.sh stop || true
docker compose down
