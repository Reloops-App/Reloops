# OpenClaw Reloops OSS API Test Prompts

Use these prompts to test whether an agent correctly uses the `openclaw-reloops-api` OSS skill.

## Skill Activation

```md
Use $openclaw-reloops-api.

Explain which Reloops OSS API surface you will use for OpenClaw agent work, what auth it expects, and which endpoints are in scope.
```

Expected:

- Uses the API-key surface.
- Mentions `Authorization: Bearer <RELOOPS_API_KEY>`.
- Names `assigned-items`, `api-workspaces`, `api-projects`, `api-assets`, `api-comments`, and `api-shares`.
- Says agent file uploads use `POST /api-assets/upload`.

## Queue Pickup

```md
Use $openclaw-reloops-api.

Show the exact request to pick up assigned work ready for review from my local OSS instance.
```

Expected:

- Uses `GET /functions/v1/assigned-items/requested-review`.
- Uses local base `http://127.0.0.1:56321/functions/v1`.
- Explains API-key scoping by `assigned_to_api_key_id`.

## Asset Review Context

```md
Use $openclaw-reloops-api.

For asset `<ASSET_ID>`, show the calls needed before leaving review feedback.
```

Expected:

- `GET /api-assets/:id`.
- `GET /api-assets/:id/versions`.
- `GET /api-comments?asset_id=...`.
- Uses full asset `download_url` for media fetch.

## Agent File Upload

```md
Use $openclaw-reloops-api.

Show how an OpenClaw agent should upload a local file into Reloops OSS.
```

Expected:

- Uses `POST /api-assets/upload`.
- Uses `multipart/form-data`.
- Includes `workspace_id`, optional `project_id`, optional `parent_asset_id`, and `file`.
- Explains that this writes to the Supabase `assets` bucket and creates the asset row.

## Register Asset Without Binary Upload

```md
Use $openclaw-reloops-api.

I have a file already available at a Supabase storage path. Show how to register it as an asset in Reloops OSS.
```

Expected:

- Uses `POST /api-assets`.
- Includes `workspace_id`, `title`, `storage_path`, `mime_type`, and optional `project_id`.
- Does not treat registration as binary upload.

## Video Comment

```md
Use $openclaw-reloops-api.

Show the payload to leave a video comment saying "Tighten this cut" at 12.5 seconds.
```

Expected:

- Uses `POST /api-comments?asset_id=...`.
- Uses `ms_offset: 12500`.

## Human Handoff

```md
Use $openclaw-reloops-api.

The agent finished its pass and wants a human to review next. Show the final status request and explain why it should not auto-approve.
```

Expected:

- Uses `PATCH /api-assets/:id` with `needs_review`.
- Avoids `approved` unless explicitly authorized.
