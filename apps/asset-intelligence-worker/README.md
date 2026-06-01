# Asset Intelligence Worker

Self-hosted worker for the OSS asset intelligence queue.

The Reloops app inserts rows into `public.asset_intelligence_jobs` when assets are uploaded or created through the agent API. This worker polls that table through `claim_asset_intelligence_job`, analyzes one claimed asset at a time, writes generated metadata back to `public.assets`, and marks the job completed or failed.

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

Default mock mode creates deterministic metadata from filename, MIME type, dimensions, and storage fields:

```bash
ASSET_AI_PROVIDER=mock
```

OpenAI mode can inspect reachable image URLs and sampled video frames:

```bash
ASSET_AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
ASSET_AI_MODEL=gpt-4.1-mini
```

For video assets, install `ffmpeg` and `ffprobe` on the machine running the worker. If frame extraction fails, the worker falls back to cover image or metadata-only analysis.

## Writes

On success, the worker updates:

- `assets.smart_description`
- `assets.smart_tags`
- `assets.ai_description`
- `assets.ai_metadata`
- `assets.updated_at`

Manual fields such as `description` and `tags` are left untouched.
