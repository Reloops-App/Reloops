#!/usr/bin/env sh
set -eu

SUPABASE_API_PORT="${SUPABASE_API_PORT:-56321}"
SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-http://127.0.0.1:${SUPABASE_API_PORT}}"
SUPABASE_INTERNAL_URL="${SUPABASE_INTERNAL_URL:-http://host.docker.internal:${SUPABASE_API_PORT}}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:6173}"

export SUPABASE_PUBLIC_URL
export SUPABASE_INTERNAL_URL
export FRONTEND_URL

if [ ! -d node_modules ] || [ ! -d apps/web/node_modules ] || [ ! -d apps/asset-intelligence-worker/node_modules ]; then
  pnpm install --frozen-lockfile
fi

node scripts/setup.mjs --quiet

sh scripts/supabase-cli.sh start
if ! sh scripts/supabase-cli.sh db push --local --yes; then
  echo "Local migration push failed. Resetting the local database and applying migrations from scratch..."
  sh scripts/supabase-cli.sh db reset --yes
fi

sleep 3
node scripts/sync-env.mjs
node scripts/ensure-storage-buckets.mjs

pnpm --filter @reloops/asset-intelligence-worker dev &
WORKER_PID=$!

cleanup() {
  kill "$WORKER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

pnpm --filter @reloops/web dev --host 0.0.0.0 --port 6173
