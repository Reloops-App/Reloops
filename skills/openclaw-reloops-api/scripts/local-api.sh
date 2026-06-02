#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.local}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

BASE_URL="${RELOOPS_BASE_URL:-http://127.0.0.1:56321/functions/v1}"
API_KEY="${RELOOPS_API_KEY:-}"

require_api_key() {
  if [[ -z "$API_KEY" ]]; then
    echo "Missing RELOOPS_API_KEY. Copy local-api.env.example to .env.local and set a key." >&2
    exit 1
  fi
}

require_tools() {
  command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
}

pretty_print() {
  if command -v jq >/dev/null; then
    jq . 2>/dev/null || cat
    return
  fi
  if command -v python3 >/dev/null; then
    python3 -m json.tool 2>/dev/null || cat
    return
  fi
  cat
}

json_string_payload() {
  local key="$1"
  local value="$2"
  python3 -c 'import json, sys; print(json.dumps({sys.argv[1]: sys.argv[2]}))' "$key" "$value"
}

json_stack_payload() {
  local src_id="$1"
  local target_id="$2"
  python3 -c 'import json, sys; print(json.dumps({"src_id": sys.argv[1], "target_id": sys.argv[2]}))' "$src_id" "$target_id"
}

json_comment_payload() {
  local body="$1"
  local ms_offset="${2:-}"
  python3 -c 'import json, sys
payload = {"body": sys.argv[1]}
if len(sys.argv) > 2 and sys.argv[2] != "":
    payload["ms_offset"] = int(sys.argv[2])
print(json.dumps(payload))' "$body" "$ms_offset"
}

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  require_api_key
  require_tools

  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$BASE_URL/$path" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body" | pretty_print
  else
    curl -sS -X "$method" "$BASE_URL/$path" \
      -H "Authorization: Bearer $API_KEY" | pretty_print
  fi
}

upload_asset() {
  local workspace_id="$1"
  local file_path="$2"
  local project_id="${3:-}"
  local parent_asset_id="${4:-}"

  require_api_key
  require_tools

  [[ -n "$workspace_id" && -n "$file_path" ]] || { usage; exit 1; }
  [[ -f "$file_path" ]] || { echo "File not found: $file_path" >&2; exit 1; }

  local content_type="application/octet-stream"
  if command -v file >/dev/null; then
    content_type="$(file --mime-type -b "$file_path")"
  fi

  local form_args=(
    -F "workspace_id=$workspace_id"
    -F "title=$(basename "$file_path")"
    -F "file=@$file_path;type=$content_type"
  )
  if [[ -n "$project_id" ]]; then
    form_args+=(-F "project_id=$project_id")
  fi
  if [[ -n "$parent_asset_id" ]]; then
    form_args+=(-F "parent_asset_id=$parent_asset_id")
  fi

  curl -sS -X POST "$BASE_URL/api-assets/upload" \
    -H "Authorization: Bearer $API_KEY" \
    "${form_args[@]}" | pretty_print
}

usage() {
  cat <<'EOF'
Usage:
  ./local-api.sh doctor
  ./local-api.sh assigned:list [limit]
  ./local-api.sh assigned:requested-review [limit]
  ./local-api.sh workspaces:list
  ./local-api.sh projects:list
  ./local-api.sh assets:list-project <project_id>
  ./local-api.sh assets:list-workspace <workspace_id>
  ./local-api.sh assets:upload <workspace_id> <file_path> [project_id] [parent_asset_id]
  ./local-api.sh assets:get <asset_id>
  ./local-api.sh assets:status <asset_id> <needs_review|in_review|approved>
  ./local-api.sh assets:versions <asset_id>
  ./local-api.sh assets:stack <src_asset_id> <target_asset_id>
  ./local-api.sh comments:list <asset_id>
  ./local-api.sh comments:create <asset_id> "Comment body" [ms_offset]
  ./local-api.sh shares:list-asset <asset_id>
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  doctor)
    require_tools
    curl -sS "$BASE_URL/api-workspaces" -H "Authorization: Bearer ${API_KEY:-missing}" | pretty_print
    ;;
  assigned:list)
    limit="${1:-}"
    api GET "assigned-items${limit:+?limit=$limit}"
    ;;
  assigned:requested-review)
    limit="${1:-}"
    api GET "assigned-items/requested-review${limit:+?limit=$limit}"
    ;;
  workspaces:list)
    api GET "api-workspaces"
    ;;
  projects:list)
    api GET "api-projects"
    ;;
  assets:list-project)
    project_id="${1:-}"
    [[ -n "$project_id" ]] || { usage; exit 1; }
    api GET "api-assets?project_id=$project_id"
    ;;
  assets:list-workspace)
    workspace_id="${1:-}"
    [[ -n "$workspace_id" ]] || { usage; exit 1; }
    api GET "api-assets?workspace_id=$workspace_id"
    ;;
  assets:upload)
    upload_asset "${1:-}" "${2:-}" "${3:-}" "${4:-}"
    ;;
  assets:get)
    asset_id="${1:-}"
    [[ -n "$asset_id" ]] || { usage; exit 1; }
    api GET "api-assets/$asset_id"
    ;;
  assets:status)
    asset_id="${1:-}"
    status="${2:-}"
    [[ -n "$asset_id" && -n "$status" ]] || { usage; exit 1; }
    api PATCH "api-assets/$asset_id" "$(json_string_payload status "$status")"
    ;;
  assets:versions)
    asset_id="${1:-}"
    [[ -n "$asset_id" ]] || { usage; exit 1; }
    api GET "api-assets/$asset_id/versions"
    ;;
  assets:stack)
    src_id="${1:-}"
    target_id="${2:-}"
    [[ -n "$src_id" && -n "$target_id" ]] || { usage; exit 1; }
    api POST "api-assets/stack" "$(json_stack_payload "$src_id" "$target_id")"
    ;;
  comments:list)
    asset_id="${1:-}"
    [[ -n "$asset_id" ]] || { usage; exit 1; }
    api GET "api-comments?asset_id=$asset_id"
    ;;
  comments:create)
    asset_id="${1:-}"
    comment_body="${2:-}"
    ms_offset="${3:-}"
    [[ -n "$asset_id" && -n "$comment_body" ]] || { usage; exit 1; }
    api POST "api-comments?asset_id=$asset_id" "$(json_comment_payload "$comment_body" "$ms_offset")"
    ;;
  shares:list-asset)
    asset_id="${1:-}"
    [[ -n "$asset_id" ]] || { usage; exit 1; }
    api GET "api-shares?asset_id=$asset_id"
    ;;
  *)
    usage
    exit 1
    ;;
esac
