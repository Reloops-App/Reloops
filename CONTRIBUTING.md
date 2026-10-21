# Contributing

Thanks for helping improve Reloops OSS.

## Development Setup

```bash
cp .env.example .env
pnpm install
pnpm start
```

Use Node.js 22+ and pnpm 10+.

## Before Opening a Pull Request

Run the release checks (unit coverage, contracts, typechecks, and production build):

```bash
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm audit --prod
```

`pnpm lint` is expected to become a required gate once the existing lint backlog is cleaned up. New changes should avoid adding lint violations.

For backend or sharing changes, also run `pnpm test:runtime` and `pnpm test:integration` with local Supabase, functions, and the mock worker running. See [Testing](docs/TESTING.md) for setup, coverage scope, and report locations. GitHub Actions runs both the web and backend suites for pull requests.

## Security-Sensitive Changes

Be careful when changing:

- Supabase Row Level Security policies
- Edge Functions that use the service-role key
- Share links, comments, and guest access
- Storage bucket visibility and signed URL behavior
- API-key creation and verification

Service-role operations must perform explicit authentication and authorization checks before reading or mutating user data.
