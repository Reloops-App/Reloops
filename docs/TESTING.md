# Testing Reloops OSS

Use Node.js 22+ and pnpm 10.13.1 (`corepack enable` if pnpm is not on your PATH).

## Default checks

```bash
pnpm install --frozen-lockfile
pnpm test
```

This runs the existing typecheck commands, unit tests with coverage thresholds, source/schema contract checks, and the production web build. No Docker, Supabase, or AI key is required.

For faster development:

```bash
pnpm test:unit
pnpm --filter @reloops/web test:watch
pnpm test:coverage
pnpm test:contracts
```

Vitest behavior tests cover private asset URL handling, link passwords, guest identities, stale upload refreshes, version grouping, recursive folder counts, member upload completion/failures/cancellation, folder uploads, file validation, and upload card states. Storage and edge functions are mocked in these tests; actual PDF rendering and backend behavior are verified separately below.

Coverage reports are written to `apps/web/coverage/index.html`, `lcov.info`, and `coverage-summary.json`. Coverage currently measures the eight modules listed in `apps/web/vitest.config.ts`, **not the entire application**. The selected modules must meet 65% statements/lines, 80% branches, and 75% functions. Private URL handling, guest upload reconciliation, and link password storage each require 100% coverage. Extend the measured module list and thresholds as new areas get behavior tests.

The older source/schema checks remain as contract checks. Their counts are not runtime behavior coverage and do not contribute to the coverage percentage.

## Browser tests without a backend

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

On Linux, use `pnpm exec playwright install --with-deps chromium` to install system dependencies too. Alternatively, set `PLAYWRIGHT_CHROME_PATH` to an existing Chrome executable.

Playwright starts an isolated Vite server on port 6273 and tests real PDF.js rendering, JPEG content and size, PDF MIME fallbacks, corrupt/unsupported files, moving upload animations, cancel/completion controls, and real audio waveform decoding with play/pause/mute behavior. A generated PDF fixture makes the tests independent of the cloud checkout. Tests use a development-only harness outside the application's production entry point.

Failures retain screenshots and traces. View the report with `pnpm exec playwright show-report`. The normal app on port 6173 can keep running.

## Local backend and browser integration tests

These tests require local Supabase, all edge functions, and the asset intelligence worker in mock mode. They create isolated users/workspaces and remove their test records and storage objects in `finally` blocks.

With Docker running, initialize the backend:

```bash
pnpm setup
pnpm supabase:start
sh scripts/supabase-cli.sh db push --local --yes
pnpm sync-env
pnpm storage:ensure
```

Set `ASSET_AI_PROVIDER=mock` in the root `.env`, then run `pnpm sync-env`. In separate terminals, start:

```bash
pnpm supabase:functions
pnpm worker:asset-intelligence
```

Then run:

```bash
pnpm test:runtime
pnpm test:integration
```

The runtime suite verifies auth/bootstrap, projects/folders, private storage, comments, notifications, API-key uploads, versions, collections, signed downloads, password-protected guest portals, guest comment ownership, folder scope, revoked links, and cross-workspace read/write/download restrictions.

The browser integration test uploads PDFs through the actual member project page and guest portal, opens the member PDF reviewer, verifies saved thumbnails and persistence after reload, and waits for the queue worker to write mock smart metadata. It requires synchronized local `.env` files. These suites use the existing local database; they do not reset it.

OpenAI calls, every reviewer interaction, every file format, and upgrades from every historical release are not covered by this initial suite.

## Docker walkthrough

Start the Docker app using the [Local Setup guide](SETUP.md), then synchronize host test credentials with the installed Supabase CLI (or `npx`):

```bash
pnpm setup
pnpm sync-env
pnpm test:runtime
RELOOPS_TEST_URL=http://127.0.0.1:6173 RELOOPS_TEST_DOCKER=1 pnpm test:integration
```

`RELOOPS_TEST_URL` uses the existing built app instead of starting Vite. `RELOOPS_TEST_DOCKER=1` also restarts the app container during the test and verifies PDFs, thumbnails, signed downloads, and guest share links survive. It temporarily interrupts the local app. Omit that flag to test an existing app without restarting it. Docker's CLI must be on PATH (or set `DOCKER_BINARY` to its executable).

## GitHub checks

`.github/workflows/tests.yml` runs on pull requests, pushes to `main`, and manual dispatch. The web job runs the default checks and standalone browser tests. The backend job starts fresh local Supabase services, functions, and the mock worker, then runs the runtime and browser integration suites. Both jobs upload test reports; the backend job also uploads function/worker logs and stops its containers. `.github/workflows/docker.yml` separately builds and starts Docker from a fresh checkout, runs the backend suite and Docker walkthrough, and collects container logs.

Repository maintainers can require the `web` and `backend` jobs in branch protection. Adding the workflow does not enable that repository setting automatically.
