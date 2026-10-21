# Local Setup

This guide runs the full Reloops OSS stack locally.

## Requirements

- Docker Desktop on macOS/Windows, or Docker Engine with Compose on Linux

For manual local development without Docker Compose, you will also need Node.js 22+, pnpm 10+, and the Supabase CLI or Node/npm with `npx`.

## Quick Start

From the repository root, run:

```bash
docker compose up -d --build --wait --wait-timeout 600
```

No host Node.js or pnpm installation is required. The first build downloads dependencies and Supabase images; later starts reuse them. Copy `.env.example` to `.env` only if you want to customize settings before starting. Keep an existing `.env` when upgrading.

Open:

```text
http://127.0.0.1:6173
```

Supabase Studio:

```text
http://127.0.0.1:56323
```

The Docker setup handles the full local stack:

- starts Supabase through Docker
- applies local migrations
- fills local Supabase keys into environment files inside the app container
- configures the built browser app with public connection settings
- serves Edge Functions
- starts the asset intelligence worker
- serves the production web build and exposes a `/healthz` health check

The multi-stage image builds the web app and worker with Linux dependencies. The runtime includes Node, ffmpeg/ffprobe, Supabase CLI, and Docker CLI; it does not run Vite or install dependencies on startup. The Compose service mounts the Docker socket and only the checkout's `supabase` directory so the CLI can manage sibling backend containers and mount edge function code at its real host path. The web app and worker run from the image, independently of host `node_modules`.

This setup still requires the repository's backend files. It builds a local image named `reloops-oss:local`; these instructions do not assume an image has been published to a registry. Run Compose from the repository root so `${PWD}` matches the backend path. Docker Desktop must allow access to that directory.

Inspect startup and health:

```bash
docker compose logs -f reloops
docker compose ps
```

Stop the stack with:

```bash
sh scripts/docker-stop.sh
```

or, from a local checkout with pnpm installed:

```bash
pnpm docker:stop
```

The stop script stops the app, stops Supabase with its data retained, then removes the Compose container/network. Database and uploaded files live in Supabase's Docker volumes and survive app rebuilds, restarts, and normal stops. `docker compose down` by itself only stops the app container; Supabase's sibling containers continue running.

Upgrade or restart:

```bash
git pull
docker compose up -d --build --wait --wait-timeout 600
docker compose restart reloops
```

Startup applies pending migrations. If a migration fails, startup stops and reports the error; it never automatically resets the database. Back up your database and uploads before upgrades. Use `supabase db dump` for database exports and back up the Supabase storage volume for original files; database exports alone do not contain file contents.

Useful Docker settings (in `.env`):

```bash
SUPABASE_PUBLIC_URL=http://127.0.0.1:56321
RELOOPS_DOCKER_SUPABASE_URL=http://host.docker.internal:56321
RELOOPS_DOCKER_DB_URL=postgresql://postgres:postgres@host.docker.internal:56322/postgres?sslmode=disable
ASSET_AI_PROVIDER=mock
OPENAI_API_KEY=
```

Docker-specific internal URLs avoid accidentally using a host development URL inside a container. Browser requests use `SUPABASE_PUBLIC_URL`. To change the web port, set `RELOOPS_WEB_PORT` and matching `FRONTEND_URL`; changing backend ports also requires editing `supabase/config.toml` and the corresponding Docker URLs. This guide targets a local installation; remote access additionally needs public URLs, auth redirects, and HTTPS configured for that host.

For an automated walkthrough of the built Docker app, including PDF review and restart persistence, see [Testing](TESTING.md#docker-walkthrough).

## Manual Local Development

Use this path if you want to run the app directly on your machine:

```bash
cp .env.example .env
pnpm install
pnpm start
```

## Optional OpenAI Metadata

The app runs without an OpenAI key. By default, `ASSET_AI_PROVIDER=mock` generates deterministic smart metadata from filenames, file types, existing tags, dimensions, and project association. It does not inspect image or video contents or call an AI service. A populated Smart Metadata panel therefore does not mean content analysis is enabled.

When an asset is created, a database trigger adds a job to `asset_intelligence_jobs`. The local worker polls every five seconds by default, processes the job, and saves `smart_description`, `smart_tags`, `ai_description`, and `ai_metadata`. Manual descriptions and tags are preserved.

For OpenAI content analysis, edit `.env`:

```bash
ASSET_AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
ASSET_AI_MODEL=gpt-4.1-mini
```

Then run:

```bash
docker compose up -d --wait --wait-timeout 600
```

For manual development with Supabase already running, sync the environment and restart the asset intelligence worker:

```bash
pnpm sync-env
pnpm worker:asset-intelligence
```

Stop the previous worker before starting its replacement. OpenAI mode requires an API key and analyzes images and sampled video frames. For video analysis, the worker needs `ffmpeg` and `ffprobe` (included in the Docker image). If frame extraction fails, it falls back to a cover image or metadata-only analysis.

To queue existing assets that are missing a smart or AI description:

```bash
pnpm ai:requeue
```

To replace existing mock metadata with OpenAI analysis, use `--all` after enabling OpenAI and restarting the worker:

```bash
pnpm ai:requeue --all
```

For a Docker-only installation, run `docker compose exec reloops node scripts/requeue-asset-intelligence.mjs --all` instead.

This reprocesses all assets, including those with existing generated metadata. You can limit it to a workspace with `--workspace=<workspace-id>`.

## Useful Commands

```bash
pnpm docker:start            # full local app through Docker Compose
pnpm docker:stop             # stop Docker Compose and local Supabase containers
pnpm start                   # full local app
pnpm dev                     # web app only
pnpm supabase:reset          # reset local database
pnpm supabase:functions      # serve all Edge Functions
pnpm worker:asset-intelligence
pnpm docker:asset-intelligence
pnpm test
```

## OpenClaw API Skill

Reloops OSS includes an OpenClaw skill for the local API-key agent surface:

```text
skills/openclaw-reloops-api
```

The local API base is:

```text
http://127.0.0.1:56321/functions/v1
```

See [OpenClaw Reloops OSS API Skill](openclaw-reloops-api.md) for setup, supported endpoints, helper scripts, and test prompts.

## Ports

- Web: `6173`
- Supabase API: `56321`
- Supabase DB: `56322`
- Supabase Studio: `56323`
- Mail UI: `56324`
- Edge inspector: `56328`
