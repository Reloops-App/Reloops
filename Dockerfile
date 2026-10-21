FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN npm install -g pnpm@10.13.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/asset-intelligence-worker/package.json apps/asset-intelligence-worker/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @reloops/asset-intelligence-worker build
# Public placeholders are replaced at startup, after the local backend keys exist.
RUN VITE_SUPABASE_URL=http://reloops-runtime.invalid \
    VITE_SUPABASE_ANON_KEY=RELOOPS_RUNTIME_ANON_KEY \
    VITE_APP_URL=http://reloops-app.invalid \
    VITE_ASSET_PUBLIC_BASE_URL=http://reloops-runtime.invalid/storage/v1/object/public/assets/ \
    VITE_RELOOPS_OSS=true pnpm --filter @reloops/web build

FROM docker:28-cli AS docker-cli

FROM node:22-bookworm-slim

ARG SUPABASE_CLI_VERSION=2.119.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

RUN mkdir -p /opt/supabase-cli \
  && cd /opt/supabase-cli \
  && npm init -y \
  && npm install "supabase@${SUPABASE_CLI_VERSION}" \
  && ln -s /opt/supabase-cli/node_modules/.bin/supabase /usr/local/bin/supabase

WORKDIR /app
RUN npm init -y && npm install --omit=dev --no-package-lock @supabase/supabase-js@2.106.2
COPY --from=build /app/apps/web/dist /opt/reloops-web
COPY --from=build /app/apps/asset-intelligence-worker/dist apps/asset-intelligence-worker/dist
COPY apps/asset-intelligence-worker/package.json apps/asset-intelligence-worker/package.json
COPY scripts scripts
COPY .env.example .env.example

EXPOSE 6173
HEALTHCHECK --interval=10s --timeout=5s --start-period=600s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:6173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/docker-start.sh"]
