# Architecture

Reloops OSS uses Supabase as the backend boundary:

- Postgres stores workspaces, members, projects, folders, assets, comments, collections, share links, API keys, and asset intelligence jobs.
- Supabase Auth owns user identity.
- Supabase Storage stores original files in `assets` and generated thumbnails in `thumbnails`.
- The browser generates thumbnails during upload for images and videos.
- Edge Functions handle public share-token access where anonymous users need controlled read/comment access.
- Agent Edge Functions expose API-key access for workspaces, projects, assets, comments, shares, and assigned review items.
- Asset intelligence is modeled as local Postgres queue state. `apps/asset-intelligence-worker` claims jobs with `claim_asset_intelligence_job` and writes AI metadata back to assets. It runs as a simple self-hosted polling process, not as an HTTP queue target.
