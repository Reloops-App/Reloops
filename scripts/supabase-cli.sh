#!/usr/bin/env sh
set -eu

if command -v supabase >/dev/null 2>&1; then
  exec supabase "$@"
fi

if command -v npx >/dev/null 2>&1; then
  exec npx supabase "$@"
fi

echo "Supabase CLI is missing. Install it globally or use a Node.js install with npx:"
echo "  npm install -g supabase"
exit 1
