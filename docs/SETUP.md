# Local Setup

This guide runs the full Reloops OSS stack locally.

## Requirements

- Docker

For manual local development without Docker Compose, you will also need Node.js 22+, pnpm 10+, and the Supabase CLI or Node/npm with `npx`.

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

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
- fills local Supabase keys into `.env`
- writes app-specific env files from `.env`
- serves Edge Functions
- starts the asset intelligence worker
- starts the web app

This image includes Node, pnpm, ffmpeg, the Supabase CLI, and the Docker CLI. The Compose service mounts the Docker socket so the Supabase CLI can start and manage the same local Supabase service containers used by `pnpm start`.

Stop the stack with:

```bash
docker compose run --rm --no-deps reloops sh scripts/supabase-cli.sh stop
docker compose down
```

or, from a local checkout with pnpm installed:

```bash
pnpm docker:stop
```

Useful Docker environment overrides:

```bash
SUPABASE_API_PORT=56321
SUPABASE_PUBLIC_URL=http://127.0.0.1:56321
SUPABASE_INTERNAL_URL=http://host.docker.internal:56321
ASSET_AI_PROVIDER=mock
OPENAI_API_KEY=
```

## Manual Local Development

Use this path if you want to run the app directly on your machine:

```bash
cp .env.example .env
pnpm install
pnpm start
```

## Optional OpenAI Metadata

The app runs without an OpenAI key. By default the asset intelligence worker uses mock metadata.

For real AI metadata, edit `.env`:

```bash
ASSET_AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
ASSET_AI_MODEL=gpt-4.1-mini
```

Then run:

```bash
docker compose up --build
```

To process assets that were uploaded before enabling OpenAI:

```bash
pnpm ai:requeue
```

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
