# Asset Intelligence Worker

Self-hosted worker for the OSS asset intelligence queue.

An `after insert` trigger on `public.assets` inserts rows into `public.asset_intelligence_jobs` when assets are created, including uploads and agent API operations. This worker polls every five seconds by default (`ASSET_AI_POLL_INTERVAL_MS=5000`) through `claim_asset_intelligence_job`, processes claimed assets, writes generated metadata back to `public.assets`, and marks each job completed or failed. The default concurrency is one job.

There is no QStash, Cloudflare Worker, hosted callback, or HTTP queue endpoint in this OSS worker.

## Run

```bash
cd apps/asset-intelligence-worker
cp .env.example .env.local
pnpm install
pnpm dev
```

From the repo root:

```bash
pnpm worker:asset-intelligence
```

## Providers

Default mock mode creates deterministic metadata from filename, MIME type, existing tags, dimensions, and project association:

```bash
ASSET_AI_PROVIDER=mock
```

It does not inspect file contents or call an AI service. Descriptions use a generic template, tags include filename tokens and file properties, and detected text, visual style, and colors are empty. Results identify both `ai_metadata.provider` and `ai_metadata.model` as `mock`, even if `ASSET_AI_MODEL` is configured with an OpenAI model name.

OpenAI mode can inspect reachable image URLs and sampled video frames:

```bash
ASSET_AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
ASSET_AI_MODEL=gpt-4.1-mini
```

For video assets, install `ffmpeg` and `ffprobe` on the machine running the worker. If frame extraction fails, the worker falls back to cover image or metadata-only analysis.

For the full local stack, edit the root `.env`, run `pnpm sync-env` with Supabase running, and restart the worker. See [Local Setup](../../docs/SETUP.md#optional-openai-metadata). Changing the provider does not automatically reprocess completed jobs. Run `pnpm ai:requeue --all` from the repo root to replace existing mock metadata, optionally adding `--workspace=<workspace-id>`. Without `--all`, only assets missing a smart or AI description are queued.

## Writes

On success, the worker updates:

- `assets.smart_description`
- `assets.smart_tags`
- `assets.ai_description`
- `assets.ai_metadata`
- `assets.updated_at`

Manual fields such as `description` and `tags` are left untouched.
