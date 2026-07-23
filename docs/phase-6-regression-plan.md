# Phase 6 regression test plan

## Release gates

Run these against every change and require all to pass:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run openapi:check`
4. `npm test`
5. `npm run build` with production-like environment variables
6. Migration preflight and the opt-in database integration suites in an isolated SQL Server database

Do not release if a response contract changes without a client update, an import can partially commit within a chunk, OpenAPI is stale, or production API docs are reachable without the feature gate and admin session.

## Automated matrix

| Area | Cases | Required result |
| --- | --- | --- |
| API errors | 401, 403, 409, 422, 429, 503; JSON and non-JSON bodies | Typed error retains status/code/request ID; rate limits retain `Retry-After` |
| Pagination | Empty, exact limit, limit + 1, multiple pages, deleted boundary row, malformed/overlong cursor | Bounded query; stable ordering; no duplicate row; invalid cursor is 400 |
| Search/input | 0, 100, and 101 characters; import row and body limits | Boundary accepted; excess rejected without truncation or DB work |
| JSON import | 1, 50, 51, and 250 rows; 251 rows; duplicates within/across chunks | SQL-safe batches; chunk is atomic; duplicate report is stable |
| Idempotency | Same key/payload replay; same key/different payload; retry after lost response | Replay returns stored result; mismatch is 409; no duplicate ledger rows |
| Maybank import | Payments only, duplicates, 500/501 rows, malformed CSV, failure during create | Whole chunk commits or rolls back; retry is safe and resumable |
| Budget plan | Every legacy POST/PATCH/DELETE action, invalid action, concurrent start/confirm, confirm replay | Existing endpoint and payloads remain compatible; one confirmed posting |
| Collections | Reward earn/redeem history, alerts, members/invites/audit, notifications | Every collection is enveloped and bounded; totals cover all rows, not just page |
| OpenAPI | Generate/check, dynamic paths, auth schemes, production gate | Generated file matches routes; cookie auth is documented; unauthorized docs hidden |
| Scripts | No flags, wrong environment, wrong confirmation, correct triple gate | Dry-run by default; unsafe invocations make no writes; audit output emitted |
| Telemetry | Dashboard/context success and forced DB failure | Structured timing logs include domain, operation, duration, outcome, and workspace when known |

## Database fault-injection scenarios

- Fail the second insert/create statement in a Maybank chunk and verify zero rows from that chunk exist afterward.
- Fail JSON import after an earlier chunk succeeds. Retry with the same run ID; earlier chunks replay and the failed chunk completes once.
- Run two identical idempotency requests concurrently and verify one posting group and one result.
- Run the same key concurrently with different bodies and verify one succeeds and one receives 409.
- Import 250 unique JSON rows to prove duplicate lookup never creates a 1,000-clause SQL expression.

## Workflow smoke suite

Test as OWNER, EDITOR, and VIEWER in both private and shared workspaces:

- create/switch/rename workspace; invite, update, and remove collaborator;
- create/edit/delete account and sub-account; add/edit/reverse/transfer a transaction;
- create every budget-plan item/source, start from setup and blank, discard, confirm with and without applying;
- create/edit a card, import Maybank CSV, account a charge, and pay a statement;
- create/edit/close a receivable, including a cross-workspace source;
- create/edit an investment and entry; verify updated invested/current values immediately appear on its card and after reload;
- create/edit reward accounts, earn and redeem miles, page history, and verify totals;
- connect/sync/disconnect Gmail and verify job retry/error states;
- mark one/all notifications read and verify the global unread count.

For each mutation, verify the relevant React Query views update without a hard reload, then reload and compare against persisted data.

## UI and device regression

At 320, 375, 390, 768, and desktop widths, open every form/modal used by the smoke suite. Verify no horizontal page scroll, no input zoom, reachable close/cancel/primary actions, visible validation, keyboard navigation, focus return, and safe-area spacing. Repeat with 200% text zoom and a mobile software keyboard.

## Performance baseline

Capture p50/p95 query-group durations and row counts for dashboard and context using small, typical, and high-volume workspaces. Compare before/after values and query plans. Only propose a cache after documenting its user/workspace key, sensitive-data scope, TTL, and every mutation that invalidates it.

## Rollback

Keep the legacy public budget-plan URL and payload contract throughout rollout. If regressions occur, disable API docs, stop import traffic, and deploy the prior application version; do not roll back successful ledger migrations or delete posting/idempotency records. Re-run reconciliation reports before reopening writes.

