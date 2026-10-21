#!/usr/bin/env sh
set -eu

node scripts/setup.mjs --quiet

sh scripts/supabase-cli.sh start
if ! sh scripts/supabase-cli.sh db push --local --yes; then
  echo "Migration failed. Existing data has been preserved. Fix the migration before restarting." >&2
  exit 1
fi
sleep 3
node scripts/sync-env.mjs
node scripts/ensure-storage-buckets.mjs

sh scripts/supabase-cli.sh functions serve --env-file .env &
FUNCTIONS_PID=$!

pnpm --filter @reloops/asset-intelligence-worker dev &
WORKER_PID=$!

cleanup() {
  kill "$FUNCTIONS_PID" >/dev/null 2>&1 || true
  kill "$WORKER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

pnpm --filter @reloops/web dev --host 127.0.0.1 --port 6173
