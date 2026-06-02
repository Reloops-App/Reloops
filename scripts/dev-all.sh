#!/usr/bin/env sh
set -eu

node scripts/setup.mjs --quiet

sh scripts/supabase-cli.sh start
if ! sh scripts/supabase-cli.sh db push --local --yes; then
  echo "Local migration push failed. Resetting the local database and applying migrations from scratch..."
  sh scripts/supabase-cli.sh db reset --yes
fi
sleep 3
node scripts/sync-env.mjs
node scripts/ensure-storage-buckets.mjs

sh scripts/supabase-cli.sh functions serve share --env-file .env &
FUNCTIONS_PID=$!

pnpm --filter @reloops/asset-intelligence-worker dev &
WORKER_PID=$!

cleanup() {
  kill "$FUNCTIONS_PID" >/dev/null 2>&1 || true
  kill "$WORKER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

pnpm --filter @reloops/web dev --host 127.0.0.1 --port 6173
