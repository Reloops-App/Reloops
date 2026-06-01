# Security Policy

## Supported Versions

Security fixes are handled on the default branch until the project publishes versioned releases.

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Report security issues by emailing the maintainers at security@reloops.app with:

- Affected component or endpoint
- Reproduction steps
- Expected and actual impact
- Any relevant logs, screenshots, or proof-of-concept details

We will acknowledge reports as soon as practical and coordinate remediation before public disclosure.

## Security Expectations

Reloops OSS is intended for self-hosted deployments. Operators are responsible for:

- Rotating Supabase service-role keys and any optional OpenAI keys
- Keeping Supabase, Docker, Node.js, pnpm, and dependencies updated
- Running the app behind HTTPS in production
- Restricting access to local `.env` files, database backups, and uploaded asset storage
