---
title: Runtime Configuration
description: Environment variable catalog, enablement rules, sensitivity, and failure behavior.
audience: [engineers, operators, security-reviewers, ai-assistants]
status: living
source_of_truth: false
last_updated: 2026-07-28
---

# Runtime configuration

## Purpose

Explain why each supported variable exists and how missing or unsafe values affect the application without exposing real values.

## Scope

Variables declared in `.env.example` and production validation behavior.

## Database

| Variable | Purpose | Required/sensitivity |
| --- | --- | --- |
| `DATABASE_URL` | Prisma SQL Server connection | Required for persistent behavior; secret |
| `SHADOW_DATABASE_URL` | Prisma development migration shadow database | Required for selected migration workflows; secret |
| `AZURE_SQL_SERVER` | Split connection server | Optional if full URL supplied |
| `AZURE_SQL_DATABASE` | Split connection database | Optional if full URL supplied |
| `AZURE_SQL_USER` | Split connection identity | Secret |
| `AZURE_SQL_PASSWORD` | Split connection password | Secret |
| `AZURE_SQL_ENCRYPT` | Require encrypted SQL transport | Keep `true` |
| `AZURE_SQL_TRUST_SERVER_CERTIFICATE` | Bypass certificate chain validation | Keep `false` in production |

## Application and Authentication

| Variable | Purpose | Required/sensitivity |
| --- | --- | --- |
| `NEXTAUTH_URL` | Canonical app/callback origin | Required; HTTPS in production |
| `NEXTAUTH_SECRET` | Session/token signing | Required secret |
| `WEBAUTHN_RP_NAME` | Passkey relying-party display name | Required for passkeys |
| `WEBAUTHN_RP_ID` | Passkey relying-party domain | Must match production domain |
| `WEBAUTHN_ORIGIN` | Exact allowed passkey origin | Must match canonical origin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in | Optional pair; secret value |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | Apple sign-in | Optional pair; secret value |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` | Facebook sign-in | Optional pair; secret value |

An OAuth provider is disabled when its pair is empty.

## Gmail and Credential Encryption

| Variable | Purpose | Required/sensitivity |
| --- | --- | --- |
| `GMAIL_REDIRECT_URI` | Optional callback override | Derives from `NEXTAUTH_URL` when empty |
| `GMAIL_SYNC_MESSAGES_PER_SLICE` | Bound messages per worker slice | Optional positive limit |
| `GMAIL_SYNC_SLICES_PER_INVOCATION` | Bound slices per invocation | Optional positive limit |
| `INTEGRATION_ENCRYPTION_KEY` | Current AES-256-GCM key | Required secret for credential storage |
| `INTEGRATION_ENCRYPTION_KEY_VERSION` | Version label in ciphertext envelope | Required with encryption |
| `INTEGRATION_ENCRYPTION_PREVIOUS_KEYS` | Old-version key map during rotation | Sensitive JSON; temporary |

Never remove a previous key until no stored envelope references its version.

## Scheduler, Delivery, and Push

| Variable | Purpose | Required/sensitivity |
| --- | --- | --- |
| `CRON_SECRET` | Authenticate scheduled routes | Required secret in production |
| `AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING` | Email transport | Optional secret |
| `AZURE_EMAIL_SENDER` | Verified sender identity | Required when email enabled |
| `CREDIT_CARD_REMINDER_CURRENCY` | Reminder display currency | Optional; defaults documented in source |
| `PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN` | Bound delivery work | Optional positive limit |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Browser push public key | Public by design |
| `VAPID_PRIVATE_KEY` | Push signing key | Secret |
| `VAPID_SUBJECT` | Push contact URI | Required when push enabled |

## Ask Nest and Search

| Variable | Purpose | Required/sensitivity |
| --- | --- | --- |
| `AI_WORKLOAD_ENDPOINT` | OpenAI-compatible workload endpoint | Required when Ask Nest enabled |
| `AI_WORKLOAD_API_KEY` | Workload credential | Secret |
| `AI_WORKLOAD_MODEL` | Model/deployment name | Required when enabled |
| `AI_WORKLOAD_INPUT_COST_PER_1M_USD` | Admin estimate rate | Optional non-secret |
| `AI_WORKLOAD_OUTPUT_COST_PER_1M_USD` | Admin estimate rate | Optional non-secret |
| `ASK_NEST_HISTORY_RETENTION_DAYS` | Conversation retention window | Optional positive days |
| `ASK_NEST_SEARCH_ENABLED` | Operator enablement gate | Search requires `true` |
| `ASK_NEST_SEARCH_EVAL_PASS` | Quality/safety approval gate | Search also requires `true` |
| `AZURE_SEARCH_ENDPOINT` | Search service URL | Required with search |
| `AZURE_SEARCH_INDEX` | Approved index name | Required with search |
| `AZURE_SEARCH_SEMANTIC_CONFIGURATION` | Semantic configuration | Optional/defaulted |
| `AZURE_SEARCH_QUERY_KEY` | Local query credential | Optional secret; otherwise managed identity |

## Retention

All are optional day windows; work is batch-bounded:

- `DATA_RETENTION_BATCH_SIZE`
- `BACKGROUND_JOB_PAYLOAD_RETENTION_DAYS`
- `BACKGROUND_JOB_RETENTION_DAYS`
- `CARD_ALERT_BODY_RETENTION_DAYS`
- `INVITE_RETENTION_DAYS`
- `READ_NOTIFICATION_RETENTION_DAYS`
- `NOTIFICATION_RETENTION_DAYS`
- `AUDIT_LOG_RETENTION_DAYS`
- `LOGIN_SESSION_RETENTION_DAYS`

Legal/organizational retention requirements are **Unknown from source code.**

## Public Providers and Administration

| Variable | Purpose | Required/sensitivity |
| --- | --- | --- |
| `MASSIVE_API_BASE_URL` | Market provider base URL | Defaulted |
| `MASSIVE_API_KEY` | Market provider credential | Optional secret |
| `SERPAPI_BASE_URL` | News provider base URL | Defaulted |
| `SERPAPI_API_KEY` | News provider credential | Optional secret |
| `SERPAPI_MONTHLY_REQUEST_LIMIT` | Application quota ceiling | Optional positive integer |
| `ADMIN` | Admin email allowlist/config | Sensitive operational configuration |
| `ENABLE_API_DOCS` | Production API docs feature gate | Default disabled |
| `NEXT_PUBLIC_LOGO_DEV_TOKEN` | Development asset helper token | Public-prefixed; do not use as a secret |
| `TRUST_PROXY_HEADERS` | Trust controlled proxy metadata | Keep false unless topology is controlled |
| `TRUSTED_COUNTRY_HEADER` | Proxy-overwritten country header name | Optional; safe only with trusted proxy |

## Test-Only Gates

- `RUN_PHASE1_DB_TESTS`
- `RUN_PHASE4_DB_TESTS`

Do not use test gates as production feature controls.

## Validation and Failure

`lib/production-config.ts` rejects unsafe or incomplete production combinations. Optional modules should report unavailable/disabled behavior rather than silently using fake credentials. Configuration presence may be logged; secret values must never be logged.

## Related Files

- [`.env.example`](../../.env.example)
- [`lib/production-config.ts`](../../lib/production-config.ts)
- [`lib/database-url.ts`](../../lib/database-url.ts)
- [Deployment guide](../guides/deployment.md)
- [Integrations](../architecture/integrations.md)

## Dependencies

- Deployment platform secret injection and provider configuration.

## Assumptions

- `.env.example` is updated whenever a supported variable changes.

## Known Limitations

- Exact production secret-store names, rotation cadence, and ownership are unknown from source code.

## Future Improvements

- Generate this catalog from a typed environment schema.
- Add a redacted configuration readiness endpoint for operators.

## Last Updated

2026-07-28
