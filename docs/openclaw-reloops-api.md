# OpenClaw Reloops OSS API Skill

Reloops OSS includes an OpenClaw skill for using the API-key agent surface:

```text
skills/openclaw-reloops-api
```

Use it when OpenClaw should pick up assigned review work, inspect assets, leave comments, update review status, or manage workspaces/projects/shares in a local or self-hosted Reloops OSS instance.

## Local API Base

When running with Docker Compose or the default local setup:

```text
http://127.0.0.1:56321/functions/v1
```

OpenClaw/API-key requests use:

```http
Authorization: Bearer <RELOOPS_API_KEY>
```

Create an API key in the Reloops UI from the organization/team API key settings.

## Supported OSS Endpoints

- `assigned-items`
- `api-workspaces`
- `api-projects`
- `api-assets`
- `api-comments`
- `api-shares`

For agent file uploads, call `POST /functions/v1/api-assets/upload` with `multipart/form-data`. The route writes to the Supabase `assets` bucket and creates the asset row. To register a file that already exists in storage, call `POST /functions/v1/api-assets` with `storage_path`.

## Helper Script

Copy the example env file and add your API key:

```bash
cp skills/openclaw-reloops-api/scripts/local-api.env.example skills/openclaw-reloops-api/scripts/.env.local
```

Then try:

```bash
skills/openclaw-reloops-api/scripts/local-api.sh doctor
skills/openclaw-reloops-api/scripts/local-api.sh assigned:requested-review
skills/openclaw-reloops-api/scripts/local-api.sh workspaces:list
skills/openclaw-reloops-api/scripts/local-api.sh assets:upload <workspace_id> ./launch-cut-v2.mp4 <project_id>
```

The complete endpoint reference is in:

```text
skills/openclaw-reloops-api/references/api_docs.md
```

The prompt test set is in:

```text
skills/openclaw-reloops-api/references/test_prompts.md
```
