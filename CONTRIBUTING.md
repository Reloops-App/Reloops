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

Run the focused release checks:

```bash
pnpm typecheck
pnpm build
node scripts/smoke-test.mjs
node scripts/collections-ui-regression.mjs
pnpm audit --prod
```

`pnpm lint` is expected to become a required gate once the existing lint backlog is cleaned up. New changes should avoid adding lint violations.

## Security-Sensitive Changes

Be careful when changing:

- Supabase Row Level Security policies
- Edge Functions that use the service-role key
- Share links, comments, and guest access
- Storage bucket visibility and signed URL behavior
- API-key creation and verification

Service-role operations must perform explicit authentication and authorization checks before reading or mutating user data.
