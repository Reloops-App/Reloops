#!/usr/bin/env sh
set -eu

: "${RELOOPS_BACKEND_DIR:?The Compose file must provide the backend checkout path}"
export SUPABASE_WORKDIR="$RELOOPS_BACKEND_DIR"
export SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-http://127.0.0.1:56321}"
export SUPABASE_INTERNAL_URL="${SUPABASE_INTERNAL_URL:-http://host.docker.internal:56321}"
export FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:6173}"
export RELOOPS_SYNC_ENV_FORCE=1

node scripts/setup.mjs --quiet
mkdir -p apps/web

node scripts/docker-local-cli.mjs start --workdir "$SUPABASE_WORKDIR" >/dev/null
if ! supabase db push --db-url "${SUPABASE_DB_URL:-postgresql://postgres:postgres@host.docker.internal:56322/postgres?sslmode=disable}" --yes --workdir "$SUPABASE_WORKDIR"; then
  echo "Migration failed. Existing data has been preserved. Fix the migration before restarting." >&2
  exit 1
fi
node scripts/sync-env.mjs
node scripts/ensure-storage-buckets.mjs
node scripts/configure-docker-web.mjs

supabase functions serve --workdir "$SUPABASE_WORKDIR" --env-file /app/.env &
FUNCTIONS_PID=$!
node --env-file=apps/asset-intelligence-worker/.env.local apps/asset-intelligence-worker/dist/index.js &
WORKER_PID=$!
WEB_PID=""

cleanup() {
  for pid in "$FUNCTIONS_PID" "$WORKER_PID" "$WEB_PID"; do
    if [ -n "$pid" ]; then kill "$pid" >/dev/null 2>&1 || true; fi
  done
}
trap cleanup EXIT
trap 'exit 0' INT TERM

node scripts/wait-functions.mjs
node scripts/serve-web.mjs &
WEB_PID=$!
echo "Reloops is ready at $FRONTEND_URL"

# Exit if a child fails so Compose can restart the whole app consistently.
while kill -0 "$FUNCTIONS_PID" && kill -0 "$WORKER_PID" && kill -0 "$WEB_PID"; do
  sleep 2
done
exit 1
