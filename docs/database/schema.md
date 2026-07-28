---
title: Database Schema
description: Complete catalog of Prisma models, fields, relationships, persistence rules, and data semantics.
audience: [engineers, database-operators, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Database schema

## Purpose

Explain the business meaning and maintenance hazards of every persisted model without duplicating the executable Prisma schema.

## Scope

Nest uses Prisma's `sqlserver` provider with `relationMode = "prisma"`. `prisma/schema.prisma` defines 61 models. SQL migrations add constraints, indexes, triggers, and filtered uniqueness that Prisma cannot fully express.

## Global conventions

| Convention | Meaning |
| --- | --- |
| `id` | Opaque string identifier, normally `cuid()` |
| `workspaceId` | Tenant boundary; include in authorization and dominant queries |
| `*Cents` | Exact integer minor currency units |
| `createdAt`, `updatedAt` | Creation and last-change timestamps |
| Uppercase status strings | Domain state; allowed values may be SQL-constrained by migrations |
| `@db.NVarChar(Max)` | Potentially large text/JSON; always bound inputs and retention |
| `onDelete: NoAction` | Avoids SQL Server multiple cascade paths; service code orders cleanup |
| `relationMode = "prisma"` | Prisma handles relations, with additional database integrity from migrations |

Money is not converted across currencies automatically. Rates use `Decimal`; ledger/balance values use SQL `INT` cents and therefore cannot exceed approximately ±21.47 million major units per field.

## Identity and security models

### `User`

- **Business meaning:** Human identity shared across workspaces.
- **Fields:** `id`, `email`, `emailVerified`, `name`, `image`, `activeWorkspaceId`, `sessionVersion`, legacy active-session fields, `lastSignedInAt`, timestamps, and relations to identity, workspace, finance, integration, passkey, push, and Ask Nest records.
- **Constraints:** Unique optional email. `sessionVersion` revokes issued sessions when incremented.
- **Risk:** `activeWorkspaceId` is a preference, not authorization.

### `Account`

- **Business meaning:** NextAuth provider account link.
- **Fields:** `id`, `userId`, provider/type identifiers, provider token fields, expiry/scope/session state, `user`.
- **Constraints:** Unique `(provider, providerAccountId)`; index on `userId`.
- **Security:** Application clears unused provider API token fields after linking.

### `Session`

- **Business meaning:** NextAuth adapter compatibility session row.
- **Fields:** `id`, unique `sessionToken`, `userId`, `expires`, `user`.
- **Note:** JWT strategy plus `LoginSession` is authoritative for active application sessions.

### `LoginSession`

- **Business meaning:** User-visible, revocable session admission and audit row.
- **Fields:** `id`, unique `sessionId`, `userId`, `provider`, `deviceName`, bounded IP/country metadata, `status`, sign-in/seen/expiry/revocation timestamps, `user`.
- **Indexes:** User/time and user/status/expiry.
- **Retention:** Old network metadata and sessions are removed by retention policy.

### `VerificationToken`

- **Business meaning:** NextAuth verification token.
- **Fields:** `identifier`, `token`, `expires`.
- **Constraints:** Unique token and `(identifier, token)`.

### `SecurityRateLimit`

- **Business meaning:** Cross-instance fixed-window/block state without storing the raw identifier.
- **Fields:** hashed key, count, window start, optional block expiry, update timestamp.
- **Risk:** SQL unavailability causes protected operations to fail rather than bypass limits.

### `IntegrationOAuthState`

- **Business meaning:** One-time Gmail OAuth/PKCE transaction.
- **Fields:** hashed state key, `userId`, `workspaceId`, encrypted verifier, expiry and creation timestamps.
- **Lifecycle:** Claimed atomically and deleted; expired rows are retained only until cleanup.

### `GmailIntegration`

- **Business meaning:** Workspace/user Gmail connection and bounded synchronization cursor.
- **Fields:** workspace, user, email, encrypted access/refresh token envelopes, token metadata/expiry, active state, last sync/history cursor, timestamps.
- **Constraints:** Unique email per workspace and composite workspace/ID ownership.
- **Security:** Token-named columns contain versioned encrypted envelopes under the current implementation; never return or log them.
- **Lifecycle:** Owner connection creates/updates the row, workers refresh credentials and cursors, and disconnect/revocation disables or removes provider access according to the service flow.

### `PasskeyCredential`

- **Business meaning:** Registered WebAuthn authenticator.
- **Fields:** user, unique credential ID, public key, replay counter, transports, device type, backup flag, display name, timestamps.
- **Security:** Private key never enters Nest.

### `WebAuthnChallenge`

- **Business meaning:** One-time registration/authentication challenge or hashed login ticket.
- **Fields:** optional user, purpose, unique challenge, expiry, creation timestamp.
- **Lifecycle:** Atomically claimed and expired.

### `PushSubscription`

- **Business meaning:** Per-user browser push endpoint and keys.
- **Fields:** user, unique endpoint, `p256dh`, `auth`, optional expiry, timestamps.
- **Security:** Treat endpoint and keys as sensitive contact data.

## Workspace and collaboration models

### `Workspace`

- **Business meaning:** Tenant and finance configuration root.
- **Fields:** identity/name, base currency, receivable defaults, shared flag, sidebar JSON, card auto-rule JSON, public net-worth switch/token, timestamps, and relations to every workspace domain.
- **Constraints:** Public token indexed; migrations enforce valid domain values and scoped defaults.
- **Risk:** JSON configuration lacks relational shape; parse through domain helpers.

### `WorkspaceMember`

- **Business meaning:** User membership and role.
- **Fields:** workspace, user, role, inviter reference, creation timestamp, relations.
- **Constraints:** Unique `(workspaceId, userId)`; user index.
- **Rule:** OWNER > EDITOR > VIEWER; legacy MEMBER normalizes to EDITOR.

### `WorkspaceInvite`

- **Business meaning:** Expiring invitation to join a workspace.
- **Fields:** workspace, normalized email, sender/optional receiver, role, hashed token, status, lifecycle timestamps.
- **Indexes:** Workspace/status, email/status, token hash.
- **Security:** Raw token is not persisted.

### `WorkspaceAuditLog`

- **Business meaning:** Human-readable record of security/workspace operations.
- **Fields:** workspace, optional actor, action, details, timestamp.
- **Index:** `(workspaceId, createdAt)`.
- **Risk:** Details must remain bounded and free of credentials/private payloads.

## Accounts, allocation, and ledger models

### `Month`

- **Business meaning:** Workspace statement-month lookup.
- **Fields:** workspace, label, year/month, sort order, active flag, timestamp, receivables.
- **Constraints:** Unique workspace/year/month and workspace/id.

### `AccountType`

- **Business meaning:** Workspace-specific category for real financial accounts.
- **Fields:** workspace, label, ordering, active/color metadata, timestamps, accounts.
- **Constraint:** Unique label per workspace.

### `FinancialAccount`

- **Business meaning:** Real-bank/current cash control total.
- **Fields:** workspace/type, name/bank/kind/description, `startingCents`, family/active/sync flags, timestamps, account/budget/transaction/receivable relations.
- **Constraints:** Unique workspace/id; workspace/kind index.
- **Rule:** `startingCents` is used as current manually configured balance, not derived from transactions.

### `BudgetEnvelope`

- **Business meaning:** Virtual sub-account assigning cash a purpose.
- **Fields:** workspace, parent account, name/icon, target/available cents, active flag, creator/timestamps, defaults/templates/transactions/groups/receivables relations.
- **Indexes:** Workspace/account and workspace/id.
- **Rule:** `availableCents` changes through ledger deltas and may be negative.

### `Transaction`

- **Business meaning:** Ledger movement associated with a real account and optional envelope/group/source.
- **Fields:** workspace/account/budget/group, kind/direction/date/amount, subject/details/notes, sync/family flags, external reference, posting/card/receivable/reversal links, void metadata, timestamps, relations.
- **Indexes:** Multiple workspace/date/account/budget/group/direction combinations plus posting/source/reversal IDs.
- **Rule:** Normal reads hide voided originals and reversal rows; reconciliation retains them.
- **Deletion:** Posted rows are reversed and voided, not physically removed.

### `PostingGroup`

- **Business meaning:** One auditable business operation containing related ledger effects.
- **Fields:** workspace, operation, optional source and actor, idempotency key, status, reversal link/reason/timestamps, transaction/receivable relations.
- **Constraint:** Unique `(workspaceId, operation, idempotencyKey)`.

### `IdempotencyRecord`

- **Business meaning:** Request claim and replay result for a posting.
- **Fields:** workspace, operation, key, request hash, state, posting ID, serialized result, lifecycle timestamps.
- **Constraint:** Unique `(workspaceId, operation, idempotencyKey)`.

### `TransactionGroup`

- **Business meaning:** User-defined grouping within one envelope.
- **Fields:** workspace, budget, name/icon, timestamps, transactions.
- **Index:** Workspace/budget/update time.
- **Rule:** Deleting a group unlinks rather than deletes its transactions.

### `ExpenseType` and `Expense`

- **Business meaning:** Optional legacy expense classification attached to an envelope and transaction.
- **Fields:** `ExpenseType` has budget, label, order/active and expenses; `Expense` links one unique transaction to a type.
- **Constraints:** Type label unique per budget; one expense per transaction.
- **Modern category note:** Ask Nest also has deterministic category classification independent of this model.

### `SalaryEntry`, `UsdAccountEntry`, `UsdInvestmentEntry`

- **Business meaning:** Legacy/specialized workspace value records retained for migration compatibility.
- **Fields:** Dated cents; USD account adds hide/description and decimal exchange rate; USD investment adds principal cents.
- **Consumers:** Current primary UI ownership is **Unknown from source code**; preserve until migration/usage analysis proves otherwise.

## Budget-plan models

### `BudgetItem`

- **Business meaning:** Reusable allocation template.
- **Fields:** workspace, title/amount, monthly flag, optional destination envelope, order/active, timestamps, monthly relations.

### `BudgetSource`

- **Business meaning:** Reusable source-of-funds template owned by a workspace member.
- **Fields:** workspace, title, owner, amount/active, timestamps, monthly relations.

### `MonthlyBudgetSource`

- **Business meaning:** Legacy monthly source snapshot.
- **Fields:** workspace/template/year/month, copied title/owner/amount, draft/confirmation state, timestamps.
- **Constraint:** Unique workspace/year/month/template.

### `MonthlyBudget`

- **Business meaning:** Legacy generated monthly source-to-item allocation.
- **Fields:** workspace, source/item, period, title/destination snapshots, allocated cents, draft/confirmed/applied state, timestamps.
- **Constraint:** Unique workspace/period/item/source.

### `MonthlyBudgetPlan`

- **Business meaning:** V2 aggregate plan for one workspace month.
- **Fields:** workspace, year/month, status, confirmation and audit timestamps, source/item lists.
- **Constraint:** Unique workspace/year/month.

### `MonthlyBudgetPlanSource`

- **Business meaning:** Source row copied or created within one monthly plan.
- **Fields:** plan, optional template source, title, owner, amount, order, timestamps.

### `MonthlyBudgetPlanItem`

- **Business meaning:** Allocation row copied or created within one monthly plan.
- **Fields:** plan, optional template item, title, amount, optional destination, order, `appliedCents`, timestamps.
- **Rule:** Remaining amount is `amountCents - appliedCents`; confirmation must not apply twice.

## Cards and receivables models

### `CreditCardAccount`

- **Business meaning:** Card metadata and statement calendar.
- **Fields:** workspace, card/bank/theme, last four, optional expiry, statement/due day, bonus thresholds, notes, sync/active state, timestamps, transaction/reward/alert relations.
- **Constraints:** Unique card name per workspace and workspace/id.
- **Security:** No PAN, cardholder name, or CVV fields.

### `CreditCardTransaction`

- **Business meaning:** Card purchase/payment allocated to a statement period.
- **Fields:** workspace/card, transaction/due dates, statement month/year, signed cents, subject, installment fields, allocation/budget state, timestamps, alert/ledger/link relations.
- **Indexes:** Workspace/card/period/date/allocation/due combinations.
- **Rule:** Negative rows offset statement payable for payments.

### `CreditCardTxnLink`

- **Business meaning:** Link between a card, ledger transaction, and optional card transaction.
- **Fields:** card/transaction IDs, snapshots, date, processed/interface state, relations.
- **Constraint:** Unique `(creditCardId, transactionId)`.

### `CardAlertStaging`

- **Business meaning:** Dedupe/diagnostic staging record for card-alert ingestion.
- **Fields:** workspace/source/bank/reference, bounded raw subject/body, hashes/keys, normalized amount/date/merchant/card last four, parse/lease/failure state, matched card/transaction, timestamps.
- **Security:** Successful raw body is not retained; failed body is encrypted, bounded, owner-only, and short-lived.

### `Receivable`

- **Business meaning:** Amount expected from another party or workspace.
- **Fields:** workspace, optional destination account/envelope/month, title/amount/dates, family/status/notes, from/to users, optional cross-workspace source IDs, posting link, timestamps, ledger relations.
- **Indexes:** Workspace/status, source-workspace/source-budget/status, posting.
- **Rule:** `OPEN` and `PARTIAL` remain outstanding; close performs full settlement posting.

## Investments, rewards, notes, and legacy models

### `InvestmentAccount`

- **Business meaning:** Investment product with lifecycle and liquidity metadata.
- **Fields:** workspace, display/institution/product names, inception/divested dates, liquid flag, timestamps, entries.

### `InvestmentEntry`

- **Business meaning:** Dated cumulative invested/current value snapshot.
- **Fields:** account, date, invested/current cents, timestamps.
- **Ordering:** Date first, then creation timestamp, then ID for deterministic latest value.

### `FrequentFlyerAccount`

- **Business meaning:** Airline loyalty account.
- **Fields:** workspace, program/airline/account metadata, current/target miles, expiry warning/policy, notes/active state, timestamps, conversions and earn/redeem relations.

### `MileProgram`

- **Business meaning:** Earn/balance lot with expiry and redemption metadata.
- **Fields:** workspace/account, date, miles/balance, expiry/title/first-redemption, timestamp, redemption details.

### `MileRedemption` and `MileRedemptionDetail`

- **Business meaning:** Redemption header and allocation across mileage lots.
- **Fields:** header has workspace/account/title/total/date/timestamp; detail links redemption to a mileage lot and redeemed count.
- **Risk:** Edits/deletes must keep account current balance and lot balances consistent.

### `HotelRewardAccount`

- **Business meaning:** Hotel loyalty point account and valuation.
- **Fields:** workspace, program/brand/account, current/target points, decimal cents-per-point, notes/active state, timestamps.

### `CreditCardReward`

- **Business meaning:** Current points/value linked one-to-one with a card.
- **Fields:** workspace/card, current points, optional value cents, update/creation timestamps, conversions.

### `PointConversion`

- **Business meaning:** Conversion from card points to frequent-flyer miles.
- **Fields:** workspace, optional source reward/destination account, from/to amounts, decimal rate, description/timestamp.

### `NoteList` and `Note`

- **Business meaning:** Legacy/general workspace notes.
- **Fields:** list has title/subject/optional amount and notes; note has workspace/list/creator/title/content, deleted/list flags, timestamps.
- **AI search note:** Repository does not show an indexing writer for these records; Azure AI Search corpus ownership is unknown from source code.

### `LegacyRecordLink`

- **Business meaning:** Idempotent mapping from legacy system/table/ID to a current model/ID.
- **Fields:** source identity, target identity, timestamp/checksum, optional unique transaction relation.
- **Constraint:** Unique `(system, sourceTable, sourceId)`.

## AI and operational models

### `AskNestTurn`

- **Business meaning:** Raw question/answer turn plus bounded quality/usage telemetry.
- **Fields:** workspace/user, question, JSON answer, page, token counts, diagnostics, tool/empty counts, duration, feedback, timestamp, relations.
- **Retention:** Raw turns expire after configurable period; usage is archived first.

### `AskNestMemory`

- **Business meaning:** Explicit user-approved, non-financial-source memory.
- **Fields:** workspace/user and hashes, kind/key/content, source turn, confidence/status, confirmation/expiry/audit timestamps.
- **Constraint:** Unique owner/key hashes.

### `AskNestUsageDaily`

- **Business meaning:** Permanent aggregate usage/quality after raw history expiration.
- **Fields:** day/workspace/user, turn/token/tool/empty/duration/feedback counts, timestamps.
- **Constraint:** Unique day/workspace/user.

### `BackgroundJob`

- **Business meaning:** Durable leased work item.
- **Fields:** type/key/scope/idempotency hashes, status and scope IDs, progress/message, payload/checkpoint/result, sanitized error, attempt/retry/dedupe counts, availability/lease/cancel/dead-letter/start/finish/audit timestamps.
- **SQL constraints:** Migrations add filtered unique active-scope and delivery idempotency indexes.

### `MassiveMarketDataCache` and `MassiveApiThrottle`

- **Business meaning:** Durable market history cache and cross-instance provider pacing.
- **Fields:** cache key/payload/fetch/expiry; provider/next allowed/update.

### `SerpApiNewsCache` and `SerpApiQuota`

- **Business meaning:** Public-news cache and conservative durable monthly allowance.
- **Fields:** cache key/payload/fetch/expiry; provider/window/request count/next allowed/update.

### `InAppNotification`

- **Business meaning:** Durable user notification.
- **Fields:** user/optional workspace, type/dedupe key, title/message/href/metadata, read/audit timestamps.
- **Constraint:** Unique `(userId, dedupeKey)`.

## Validation and serialization

- Request-level Zod schemas enforce most string lengths and domain inputs.
- Phase 4 SQL adds checks for state values, dates, currency codes, and scoped references.
- Prisma serializes dates as ISO JSON values in API responses.
- `BigInt` fields require explicit conversion before JSON; passkey counters and push expiration are handled by route code.
- Decimal rates must be serialized deliberately; do not add them as JavaScript floating-point money.

## Related Files

- [`prisma/schema.prisma`](../../prisma/schema.prisma)
- [Indexes and constraints](indexing.md)
- [Migration history](migrations.md)
- [Business rules](../business/business-rules.md)

## Dependencies

- Prisma 6 and SQL Server/Azure SQL.
- Forward migrations for integrity not representable in Prisma.

## Assumptions

- Deployed environments have applied every recorded migration.

## Known Limitations

- Prisma relation definitions alone do not show every SQL trigger/check/filtered index.
- Several legacy models remain without clearly active UI ownership.
- Backup, partitioning, and data-residency policy are not encoded in schema.

## Future Improvements

- Rename `FinancialAccount.startingCents` to reflect current-control semantics.
- Migrate large identifier columns to bounded sizes where safe.
- Add schema comments for domain status values and classification.

## Last Updated

2026-07-28
