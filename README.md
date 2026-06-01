<p align="center">
  <picture>
    <img alt="Reloops Logo" src="docs/assets/reloops-logo.png" width="220"/>
  </picture>
</p>

<p align="center">
<a href="https://opensource.org/license/agpl-v3">
  <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License">
</a>
</p>

<h3 align="center"><strong><a href="docs/SETUP.md">NEW: run the open-source Reloops DAM locally in minutes</a></strong></h3>
<div align="center">
  <strong>
  <h2>🎨 Open-source creative asset workspace for teams and AI agents 🤖</h2><br />
  Reloops: An alternative to Brandfolder, Bynder, Canto, Frame.io, Dropbox Replay, Ziflow, Filestage, and internal DAM tools.<br /><br />
  </strong>
  Reloops gives you everything you need to organize creative assets,<br />manage versions, collect approvals, enrich metadata, share collections, and let agents work inside your media library.
</div>

<div class="flex" align="center">
  <br />
  <strong>DAM</strong>
  &nbsp;·&nbsp;
  <strong>Collections</strong>
  &nbsp;·&nbsp;
  <strong>Metadata</strong>
  &nbsp;·&nbsp;
  <strong>Search</strong>
  &nbsp;·&nbsp;
  <strong>Versions</strong>
  &nbsp;·&nbsp;
  <strong>Approvals</strong>
  &nbsp;·&nbsp;
  <strong>Share Links</strong>
  &nbsp;·&nbsp;
  <strong>Agent API</strong>
</div>

<p align="center">
  <br />
  <a href="docs/SETUP.md" rel="dofollow"><strong>Start locally »</strong></a>
  <br />

  <br />
  <a href="#intro" rel="dofollow"><strong>See what Reloops does »</strong></a>
  <br />
</p>

<p align="center">
  <a href="docs/SETUP.md">Quick Start</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#a-modern-alternative-to-closed-dam-and-creative-review-tools">Alternative To</a>
  ·
  <a href="#tech-stack">Tech Stack</a><br />
</p>
<p align="center">
  <a href="#agent-ready-dam">Agent-ready DAM</a>
  ·
  <a href="#self-hosted-oss">Self-hosted OSS</a>
  ·
  <a href="#license">License</a>
</p>

<br /><br />

## A modern alternative to closed DAM and creative review tools

Reloops is a DAM-first product. Review and approval are built in because assets do not stop at storage.

| If you are using... | Reloops helps you replace or extend it with... |
|---------------------|-----------------------------------------------|
| Brandfolder, Bynder, Canto | A self-hosted creative DAM for projects, collections, metadata, search, and asset history |
| Google Drive, Dropbox, Notion, Airtable | A purpose-built asset workspace instead of folders, rows, and scattered comments |
| Frame.io, Dropbox Replay, Wipster | Asset review, comments, version stacks, approvals, and share links inside the DAM |
| Ziflow, Filestage, ReviewStudio | Structured creative feedback without a heavyweight enterprise approval suite |
| Zapier, n8n, Make, custom agents | Controlled API actors that can create projects, fetch assets, comment, enrich metadata, and manage shares |
| A custom internal DAM | Auth, storage, asset views, review UI, share links, API keys, and local workers already wired together |

## 🔌 See the leading Reloops features

<p align="center">
  <img alt="Reloops creative asset workspace" src="docs/assets/reloops-workspace.png" />
</p>

## ✨ Features

### Find any asset instantly

Search across folders, tags, metadata, status, people, smart descriptions, dates, formats, and version stacks from one focused DAM surface.

<p align="center">
  <img alt="Reloops digital asset search" src="docs/assets/reloops-dam-search.png" />
</p>

### Keep every campaign moving

Move assets from needs review to approved with project-level workflow boards, progress indicators, filters, bulk selection, upload, share, and download actions.

<p align="center">
  <img alt="Reloops project workflow" src="docs/assets/reloops-kanban-workflow.png" />
</p>

### Turn media into searchable knowledge

Generate descriptions and tags so creative assets become searchable, reusable, and easier for agents to understand.

<p align="center">
  <img alt="Reloops smart metadata" src="docs/assets/reloops-smart-metadata.png" />
</p>

### Publish collections clients can actually use

Package campaign assets into branded collections that can be browsed, searched, downloaded, and shared without exposing the whole workspace.

<p align="center">
  <img alt="Reloops published collection" src="docs/assets/reloops-published-collection.png" />
</p>

### Share review links without losing control

Create controlled asset or collection links with download permissions, comments, locked item sets, and expiration settings.

<p align="center">
  <img alt="Reloops share link controls" src="docs/assets/reloops-share-link.png" />
</p>

### Invite agents into the DAM

Create developer keys for OpenClaw, OpenAI, Claude, Gemini, Zapier, n8n, Replicate, Runway, and custom agents so automation can operate inside your creative asset system.

<p align="center">
  <img alt="Reloops agent and developer keys" src="docs/assets/reloops-agent-keys.png" />
</p>

# Intro

- Organize every campaign asset in a self-hosted creative DAM.
- Move assets through project workflows from needs review to approved.
- Search by name, type, folder path, status, tags, people, dates, usage fields, and AI-generated metadata.
- Manage versions, approvals, share links, and guest review feedback without losing asset history.
- Build dynamic collections for campaigns, clients, teams, launches, and reusable asset groups.
- Track review activity, file updates, mentions, and smart metadata jobs from a notification center.
- Invite humans and agents into the same creative workspace.
- Perfect for automation with platforms like n8n, Make, Zapier, OpenClaw, custom agents, and internal workflows.

## Agent-ready DAM

- API-key actors can operate inside organization workspaces.
- Agents can list and create workspaces and projects.
- Agents can fetch assets, patch asset status, create comments, and manage share links.
- The local asset intelligence worker can generate smart descriptions and tags.
- Generated media can flow back into the same library, collection, review, and approval loop.

## Tech Stack

- Pnpm workspaces
- Vite + React
- Supabase Auth, Postgres, Storage, and Edge Functions
- Node asset intelligence worker
- Docker for local Supabase services

## Quick Start

To have the project up and running, please follow the [Local Setup Guide](docs/SETUP.md).

## Self-hosted OSS

- Supabase Auth, Postgres, Storage, and Edge Functions
- Workspaces, teams, projects, folders, assets, versions, comments, and reviews
- Collections, metadata filtering, share links, and guest comments
- API-key agent endpoints
- Local asset intelligence worker with DB queue polling

Reloops OSS does not include hosted billing, hosted cloud storage integrations, hosted workers, analytics, QStash, Cloudflare Workers, commercial deployment infrastructure, or managed screenshot capture. Uploads use Supabase Storage, and website review works with uploaded or captured screenshots.

## License

This repository's source code is available under the [AGPL-3.0 license](LICENSE).
