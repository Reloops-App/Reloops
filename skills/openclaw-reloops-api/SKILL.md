---
name: openclaw-reloops-api
description: Use when OpenClaw should manage Reloops OSS assigned review work, workspaces, projects, assets, comments, or shares through the API-key HTTP surface.
compatibility: Requires HTTP access to a running Reloops OSS Supabase functions endpoint and a Reloops API key created in the app.
metadata:
  short-description: Call Reloops OSS assigned-work and asset APIs from OpenClaw
---

# OpenClaw Reloops OSS API

Use this skill when an OpenClaw agent needs to inspect or mutate Reloops OSS data through the API-key agent surface.

## Quick Rules

- This is the OSS version of the OpenClaw Reloops API skill.
- Default local API base: `http://127.0.0.1:56321/functions/v1`.
- Docker quick-start runs the same API through `pnpm docker:start`.
- API-key requests send `Authorization: Bearer <reloops API key>`.
- Implemented OSS public/API-key routes are `assigned-items`, `api-workspaces`, `api-projects`, `api-assets`, `api-comments`, and `api-shares`.
- For agent file uploads, use `POST /functions/v1/api-assets/upload` with `multipart/form-data`; this writes to the Supabase `assets` bucket and creates the asset row.
- To register an asset that already exists in storage, use `POST /functions/v1/api-assets` with `storage_path`.
- Read [references/api_docs.md](references/api_docs.md) for exact request and response shapes.
- Prefer the polling-first assigned-workflow for review tasks.

## Default Workflow

1. Poll assigned work with `GET /functions/v1/assigned-items/requested-review`.
2. Pick an assigned asset and fetch details with `GET /functions/v1/api-assets/:id`.
3. Load version context with `GET /functions/v1/api-assets/:id/versions`.
4. Load discussion context with `GET /functions/v1/api-comments?asset_id=...`.
5. When the agent starts work, set the asset to `in_review` with `PATCH /functions/v1/api-assets/:id`.
6. Leave comments with `POST /functions/v1/api-comments?asset_id=...`.
7. If uploading a new file, use `POST /functions/v1/api-assets/upload`; include `parent_asset_id` when it should become the next version of an existing asset.
8. If registering a revision that already exists in storage, create/register it with `POST /functions/v1/api-assets`, then stack it with `POST /functions/v1/api-assets/stack`.
9. When done, set the final status:
   - `needs_review` if a human should review next
   - `approved` only if the workflow explicitly allows the agent to close the loop

## Media Rules For OSS

- Full asset fetches and versions include `download_url` generated from Supabase Storage public URLs.
- The web UI builds preview/download URLs from `VITE_ASSET_PUBLIC_BASE_URL + storage_path`.
- In local Docker, `VITE_ASSET_PUBLIC_BASE_URL` is derived from the local Supabase API URL.
- Browser preview support is not the same as asset availability; `.mov` files may upload/register but fail browser playback if the codec is unsupported.
- `cover_image_url` is the poster/thumbnail field when present.

## Comment Contract

- Reloops comments use:
  - `body`
  - `ms_offset`
  - `drawing_json`
  - `parent_id`
  - `media_ms_start`
  - `media_ms_end`
  - `status`
  - `author_user_id`
  - `author_api_key_id`
- For public agent comments, `author_user_id` is attributed to the API key creator and `author_api_key_id` is set to the active API key.
- `api-comments` supports list/create only.
- Body-only comments are valid and default to `ms_offset: 0`.
- For video comments tied to a precise moment, set `ms_offset` in milliseconds.
- For video range comments, set `media_ms_start` and `media_ms_end` in milliseconds.

## Version And Assignment Rules

- `assigned_to_api_key_id` drives the API-key pickup queue.
- API-key callers to `assigned-items` are filtered by `assigned_to_api_key_id`.
- User-session callers to `assigned-items` are filtered by `assigned_to`.
- Before posting feedback, inspect versions with `GET /api-assets/:id/versions`.
- If registering a new revision, keep it in the same version chain with `POST /api-assets/stack`.
- Do not create a detached asset when the task asks for the next version of an existing asset.

## Important Boundaries

- Public `PATCH /api-assets/:id` only updates `status`.
- Allowed public statuses are `needs_review`, `in_review`, and `approved`.
- Broad asset mutation and assignment are handled by session-only app functions, not this API-key surface.
- The public binary upload endpoint in Reloops OSS is `POST /functions/v1/api-assets/upload`.
- There is no standalone public thumbnail-generation function.
- Share-link guest commenting is handled by the session `comment` function with `share_token`, not `api-comments`.

## Output Style

- Prefer concrete `curl` or HTTP examples.
- Use exact field names from the API reference.
- Ask for missing identifiers only when required for the next call.
