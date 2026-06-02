FROM node:22-bookworm-slim

ARG SUPABASE_CLI_VERSION=2.98.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl docker.io ffmpeg git \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && mkdir -p /opt/supabase-cli \
  && cd /opt/supabase-cli \
  && npm init -y \
  && npm install "supabase@${SUPABASE_CLI_VERSION}" \
  && ln -s /opt/supabase-cli/node_modules/.bin/supabase /usr/local/bin/supabase

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/asset-intelligence-worker/package.json apps/asset-intelligence-worker/package.json

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 6173

CMD ["sh", "scripts/docker-start.sh"]
