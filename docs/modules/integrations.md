---
title: Gmail and Imports Module
description: Gmail OAuth and alert synchronization, card-alert parsing, Maybank CSV, bulk imports, dedupe, and provider safety.
audience: [engineers, operators, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Gmail and imports

## Purpose

Bring external card/transaction data into Nest through bounded, reviewable, replay-safe workflows.

## Scope

Gmail OAuth, encrypted credentials, Gmail message/history clients, job runner, alert parsing/ingestion, Maybank card CSV, and generic transaction bulk import.

## Responsibilities

- Create/consume one-time PKCE OAuth state.
- Encrypt, refresh, rotate, revoke, and delete Gmail grants.
- Query only supported alert subjects and use Gmail history cursors.
- Process bounded pages with durable checkpoints.
- Parse supported DBS/UOB/OCBC-style alert formats.
- Hash/deduplicate source messages and normalized transactions.
- Parse Maybank CSV with skip rules.
- Chunk generic/Maybank imports and atomically post/dedupe.

## Public APIs and important symbols

| File | Exported surface | Purpose |
| --- | --- | --- |
| `lib/integration-oauth-state.ts` | create/consume | State+PKCE lifecycle |
| `lib/credential-encryption.ts` | encrypt/decrypt/context | Versioned AES-GCM |
| `lib/gmail.ts` | consent/token/profile/list/fetch/revoke | Redacted provider client |
| `lib/gmail-alert-query.ts` | supported subjects/query/due | Consistent filtering |
| `lib/gmail-sync-runner.ts` | queue/process/scheduled | Bounded leased sync |
| `lib/credit-alert-parser.ts` | parser | Bank-body normalization |
| `lib/credit-alert-ingest.ts` | ingest | Dedupe/staging/card creation |
| `lib/maybank-csv.ts` | parse/normalize/skip | CSV adapter |
| `lib/domains/integrations/import-contracts.ts` | schemas/caps | Transport bounds |
| `maybank-import-service.ts` | chunk import | Atomic card import |

## Internal workflow

See [Gmail sequence](../diagrams/gmail-job-sequence.mmd). Generic import uses one import-run ID and stable per-chunk idempotency key; Maybank limits parsed rows to 500 and CSV chunk to 512 KiB. Generic transaction import limits a request to 250 rows and 1 MiB.

## Configuration

Google OAuth client pair, optional redirect URI, encryption current/version/previous keys, Gmail messages per slice and slices per invocation.

## Error handling

- OAuth state mismatch/expiry fails without storing tokens.
- Provider errors map to stable redacted codes.
- Expired Gmail history falls back to bounded query mode.
- Gone messages count as failed/skipped without aborting whole page.
- Import duplicates are reported separately; mismatched idempotency conflicts.

## Performance considerations

- Metadata-first Gmail fetch reduces full-body reads.
- Slice/page caps trade backlog latency for predictable execution.
- SQL duplicate queries use batches of 50.
- `createMany` and posting commit together.

## Security considerations

- Credential AAD binds integration/workspace/field.
- Gmail connect/disconnect requires OWNER and recent auth where routes enforce it.
- Raw bodies are sensitive and retention-bound.
- CSV/JSON data is untrusted; content/row/string limits apply.
- Never add live data scripts without dry-run and exact workspace gates.

## Risks

- Bank email/CSV format changes can silently reduce parsing.
- Removing an old encryption key before rewrapping breaks credentials.
- Provider history cursor bugs can duplicate/miss alerts; durable dedupe is required.

## Future extension points

- New bank parser via sanitized fixtures and explicit subject/query update.
- Import preview and row-level validation report.

## Related Files

- [Integration API](../api/integrations.md)
- [External integrations](../architecture/integrations.md)
- [BR-065–BR-067](../business/business-rules.md)

## Dependencies

- Gmail API, cards/ledger, SQL jobs, credential key configuration.

## Assumptions

- Only configured supported formats are parsed.

## Known Limitations

- No generic bank-feed integration.
- Provider integration tests are contract/static, not live.

## Future Improvements

- Add recorded sanitized provider-contract test fixtures.

## Last Updated

2026-07-28
