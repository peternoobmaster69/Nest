# Phase 0 security containment record

Date: 2026-07-14

## Dependency gate

- Next.js and `eslint-config-next` were upgraded from 16.1.6 to 16.2.10.
- `npm audit --omit=dev` reports 0 critical, 0 high, and 4 moderate findings.
- The remaining findings are the Next.js/PostCSS chain and the NextAuth/UUID chain. npm proposes unsupported or regressive major downgrades rather than compatible fixes, so they are retained for the Phase 2 authentication migration and future framework patch upgrades.

## Card-data containment

- Card-detail reveal is disabled and always uses `Cache-Control: no-store`.
- Create and update schemas no longer contain a CVV/CVC field and reject unknown fields.
- `prisma/migrations/phase_0_purge_credit_card_cvv/migration.sql` first overwrites all stored CVV ciphertext, IV, and tag values with `NULL`, then drops those three columns.
- Full card-number reveal is disabled. Existing encrypted PAN storage remains temporarily for the Phase 3 vault/last-four decision.

## Verification note

The normal `npm run build` wrapper can be blocked on Windows when another process holds Prisma's generated engine DLL. In that state, `npx next build` is the non-destructive build verification path; no user-owned process should be stopped to release the lock.
