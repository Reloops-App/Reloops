# Local Setup

This guide runs the full Reloops OSS stack locally.

## Requirements

- Node.js 22+
- pnpm 10+
- Docker
- Supabase CLI, or Node/npm with `npx`

## Run Locally

```bash
cp .env.example .env
pnpm install
pnpm start
```

Open the URL printed by Vite, usually:

```text
http://127.0.0.1:6173
```

Supabase Studio:

```text
http://127.0.0.1:56323
```

`pnpm start` handles the local stack:

- starts Supabase through Docker
- applies local migrations
- fills local Supabase keys into `.env`
- writes app-specific env files from `.env`
- serves Edge Functions
- starts the asset intelligence worker
- starts the web app

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
pnpm start
```

To process assets that were uploaded before enabling OpenAI:

```bash
pnpm ai:requeue
```

## Useful Commands

```bash
pnpm start                   # full local app
pnpm dev                     # web app only
pnpm supabase:reset          # reset local database
pnpm supabase:functions      # serve all Edge Functions
pnpm worker:asset-intelligence
pnpm docker:asset-intelligence
pnpm test
```

## Ports

- Web: `6173`
- Supabase API: `56321`
- Supabase DB: `56322`
- Supabase Studio: `56323`
- Mail UI: `56324`
- Edge inspector: `56328`
