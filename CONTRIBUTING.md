# Contributing to Nest

Thank you for helping improve Nest. Keep contributions focused, reviewable, and
safe for a personal-finance application.

## Development setup

1. Install the Node.js version in `.nvmrc`.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and configure only the integrations you need.
4. Run `npm run prisma:generate`.
5. Start the application with `npm run dev`.

Never commit `.env`, credentials, production data, exported financial records,
OAuth tokens, or screenshots containing personal information.

## Before opening a pull request

Run:

```bash
npm run check
npm run build
npm run audit:public
```

Use a focused branch and explain the user impact, validation, and any migration
requirements in the pull request. Changes to financial posting must preserve
workspace authorization, integer-cent arithmetic, idempotency, and auditable
reversals.

## Security reports

Do not open a public issue for a vulnerability. Follow the private reporting
instructions in [SECURITY.md](SECURITY.md).
