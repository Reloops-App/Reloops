FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/asset-intelligence-worker/package.json apps/asset-intelligence-worker/package.json

RUN pnpm install --filter @reloops/asset-intelligence-worker... --frozen-lockfile

COPY apps/asset-intelligence-worker apps/asset-intelligence-worker

RUN pnpm --filter @reloops/asset-intelligence-worker build

WORKDIR /app/apps/asset-intelligence-worker

CMD ["node", "dist/index.js"]
