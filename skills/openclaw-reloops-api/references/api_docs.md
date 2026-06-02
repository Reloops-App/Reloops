# Reloops OSS API-Key Reference

This file documents the API-key agent surface implemented in Reloops OSS.

## Authentication

Local Docker/default base path:

```text
http://127.0.0.1:56321/functions/v1
```

API-key auth:

```http
Authorization: Bearer <RELOOPS_API_KEY>
```

Create API keys in the Reloops UI under organization/team API key settings.

## Implemented OSS Public Endpoints

- `GET /functions/v1/assigned-items`
- `GET /functions/v1/assigned-items/requested-review`
- `GET /functions/v1/api-workspaces`
- `POST /functions/v1/api-workspaces`
- `GET /functions/v1/api-projects`
- `POST /functions/v1/api-projects`
- `GET /functions/v1/api-assets?project_id=...`
- `GET /functions/v1/api-assets?workspace_id=...`
- `POST /functions/v1/api-assets`
- `POST /functions/v1/api-assets/upload`
- `GET /functions/v1/api-assets/:id`
- `PATCH /functions/v1/api-assets/:id`
- `GET /functions/v1/api-assets/:id/versions`
- `POST /functions/v1/api-assets/stack`
- `GET /functions/v1/api-comments?asset_id=...`
- `POST /functions/v1/api-comments?asset_id=...`
- `POST /functions/v1/api-shares`
- `GET /functions/v1/api-shares?asset_id=...`
- `GET /functions/v1/api-shares?project_id=...`
- `DELETE /functions/v1/api-shares/:id`

The OSS upload route writes directly to Supabase Storage and creates the asset row. Public thumbnail generation is not exposed as a separate API route.

## Assigned Work

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/assigned-items/requested-review' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Optional query params:

- `limit`: default `100`, minimum `1`, maximum `500`

For API-key callers, results are scoped to `assigned_to_api_key_id`.

## Workspaces

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-workspaces' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Create:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-workspaces' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Launch Campaigns","logo_url":"https://example.com/logo.png"}'
```

## Projects

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-projects' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Create:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-projects' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"workspace_id":"<WORKSPACE_ID>","name":"Spring Promo"}'
```

## Assets

List by project:

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-assets?project_id=<PROJECT_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

List by workspace:

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-assets?workspace_id=<WORKSPACE_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Fetch one asset with `download_url`:

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-assets/<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Register an asset whose file already exists in storage:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-assets' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "workspace_id": "<WORKSPACE_ID>",
    "project_id": "<PROJECT_ID>",
    "title": "launch-cut-v2.mp4",
    "storage_path": "workspaces/<WORKSPACE_ID>/launch-cut-v2.mp4",
    "mime_type": "video/mp4",
    "size_bytes": 15000000,
    "description": "Agent-created revision",
    "tags": ["agent", "revision"]
  }'
```

Upload a file into Supabase Storage and create the asset row:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-assets/upload' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -F "workspace_id=<WORKSPACE_ID>" \
  -F "project_id=<PROJECT_ID>" \
  -F "title=launch-cut-v2.mp4" \
  -F "tags=[\"agent\",\"revision\"]" \
  -F "file=@./launch-cut-v2.mp4;type=video/mp4"
```

Upload a new version of an existing asset:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-assets/upload' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -F "workspace_id=<WORKSPACE_ID>" \
  -F "parent_asset_id=<ASSET_ID>" \
  -F "title=launch-cut-v3.mp4" \
  -F "file=@./launch-cut-v3.mp4;type=video/mp4"
```

The response includes the created asset row, `storage_path`, and `download_url`.

Update status:

```bash
curl -sS -X PATCH 'http://127.0.0.1:56321/functions/v1/api-assets/<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"status":"in_review"}'
```

Allowed statuses:

- `needs_review`
- `in_review`
- `approved`

Versions:

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-assets/<ASSET_ID>/versions' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Stack an existing source asset onto a target/root asset:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-assets/stack' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"src_id":"<SRC_ASSET_ID>","target_id":"<TARGET_ASSET_ID>"}'
```

## Comments

List comments:

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-comments?asset_id=<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Create a general comment:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-comments?asset_id=<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"body":"The logo needs more padding from the top edge."}'
```

Create a video timestamp comment at 12.5 seconds:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-comments?asset_id=<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Tighten this cut.","ms_offset":12500}'
```

Create a range comment:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-comments?asset_id=<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"body":"This section drags; compress the pacing.","media_ms_start":3200,"media_ms_end":5800}'
```

## Shares

Create:

```bash
curl -sS -X POST 'http://127.0.0.1:56321/functions/v1/api-shares' \
  -H "Authorization: Bearer $RELOOPS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"asset_id":"<ASSET_ID>","allow_download":true,"allow_comments":true}'
```

List by asset:

```bash
curl -sS 'http://127.0.0.1:56321/functions/v1/api-shares?asset_id=<ASSET_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```

Revoke:

```bash
curl -sS -X DELETE 'http://127.0.0.1:56321/functions/v1/api-shares/<SHARE_ID>' \
  -H "Authorization: Bearer $RELOOPS_API_KEY"
```
