#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f ".env" ]; then
  echo "Missing .env. Run: pnpm sync-env"
  exit 1
fi

if ! grep -q "^SUPABASE_SERVICE_ROLE_KEY=" .env; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY in .env. Run: pnpm sync-env"
  exit 1
fi

docker compose -f docker-compose.asset-intelligence.yml up --build asset-intelligence-worker
