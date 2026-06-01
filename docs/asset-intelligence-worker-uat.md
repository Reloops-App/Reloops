# Asset Intelligence Worker UAT

Use this checklist to verify the local OSS asset intelligence worker.

## Setup

1. Start the local stack:

   ```bash
   pnpm start
   ```

2. Keep `ASSET_AI_PROVIDER=mock` for deterministic local testing, or set `ASSET_AI_PROVIDER=openai` and provide `OPENAI_API_KEY` for real metadata generation.

## Checks

- Upload an image asset.
- Confirm a row is inserted into `asset_intelligence_jobs`.
- Confirm the worker claims the queued job and marks it `completed`.
- Confirm the asset receives generated metadata such as tags or description fields.
- Upload a video asset if `ffmpeg`/`ffprobe` are available locally.
- Confirm worker failures are recorded with an error message and do not crash the process.

## Requeue Existing Assets

```bash
pnpm ai:requeue
```

Expected result: eligible assets receive queued jobs and are processed by the worker.

## Failure Recovery

- Temporarily set a bad `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
- Restart the worker and confirm it exits or reports authentication failures.
- Restore the key and restart the worker.
- Confirm queued jobs can be processed again.

The OSS worker should not require QStash, Cloudflare Workers, hosted callbacks, or any hosted queue service.
