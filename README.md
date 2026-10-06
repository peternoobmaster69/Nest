# Nest

Nest is a personal finance web application focused on:

- Virtual budget accounts (envelope style)
- Credit card tracking with encrypted sensitive fields (AES-256-GCM)
- Receivables and shared-workspace collaboration
- Savings, investments, and full money-flow visibility

Read [guide.md](guide.md) for the account, budgeting, payable, receivable,
savings, and investment model.

Read the [0.1.0 prerelease notes](docs/releases/0.1.0-prerelease.md) for the
October 6, 2026 feature snapshot, setup requirements, and known limitations.

Stack:

- Next.js + React + TypeScript
- Tailwind CSS
- Prisma ORM + Azure SQL (`sqlserver`)
- NextAuth (Apple, Google, Facebook providers)
- React Query for client data fetching

## Getting Started

Requirements:

- Node.js 22.13 or newer (the recommended major version is in `.nvmrc`)
- npm
- SQL Server or Azure SQL

1. Copy environment variables and fill values:

```bash
cp .env.example .env
```

`DATABASE_URL` should normally be a complete Prisma SQL Server URL:

```env
DATABASE_URL="sqlserver://server.database.windows.net:1433;database=nest;user=app_user;password=***;encrypt=true;trustServerCertificate=false"
```

The split `AZURE_SQL_*` variables in `.env.example` are an alternative when `DATABASE_URL` contains only the hostname. `SHADOW_DATABASE_URL` is only for a separate disposable local/staging migration-authoring database.

2. Install dependencies:

```bash
npm install
```

3. Generate Prisma client:

```bash
npm run prisma:generate
```

4. Run migrations:

```bash
npm run prisma:migrate
```

For a new empty SQL Server database, use `npm run db:bootstrap`. Shared and production environments use `npm run prisma:migrate:deploy`, never `migrate dev` or `db push`. See [the database operations runbook](docs/database/operations.md).

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Workspace routing

Authenticated application pages use `/w/{workspaceId}/...` URLs. The URL is the
canonical workspace context, so different browser tabs can remain in different
workspaces. Client API requests copy that value into `X-Workspace-Id`, and every
server request still verifies membership and the required workspace role.

The `nest-active-workspace` cookie is retained only as the last-used default for
bare or legacy application URLs. It must not be used as the primary scope for a
request made from a workspace URL.

## Ask Nest

Ask Nest is a read-only assistant for questions about the active workspace. It uses Azure OpenAI's v1 Responses API with local, workspace-scoped finance tools; the model never receives database credentials or mutation capabilities.

Configure these server-only environment variables:

```env
AI_WORKLOAD_ENDPOINT="https://your-resource.openai.azure.com"
AI_WORKLOAD_API_KEY="***"
AI_WORKLOAD_MODEL="your-model-deployment-name"
AI_WORKLOAD_INPUT_COST_PER_1M_USD="your-input-price-per-million-tokens"
AI_WORKLOAD_OUTPUT_COST_PER_1M_USD="your-output-price-per-million-tokens"
ADMIN="admin@example.com"
ASK_NEST_HISTORY_RETENTION_DAYS="90"
CARD_ALERT_BODY_RETENTION_DAYS="7"
CRON_SECRET="a-long-random-secret"
MASSIVE_API_BASE_URL="https://api.massive.com"
MASSIVE_API_KEY="***"
SERPAPI_BASE_URL="https://serpapi.com"
SERPAPI_API_KEY="***"
SERPAPI_MONTHLY_REQUEST_LIMIT="200"
```

`AI_WORKLOAD_ENDPOINT` may be the Azure OpenAI resource root or its `/openai/v1/` base URL. `AI_WORKLOAD_MODEL` must be the Azure deployment name and must support the Responses API, function calling, and structured outputs. Restart the application after changing environment variables.

`ADMIN` is the single email address allowed to open `/admin`. The comparison is case-insensitive and the route is unavailable when `ADMIN` is missing.

Set the optional token-rate variables to your Azure deployment's current USD prices. The admin page uses them to estimate Ask Nest cost from recorded input/output tokens; it does not replace Azure billing and does not account for deployment-specific discounts or surcharges.

Ask Nest history and user-approved memory are persisted per user and workspace. Raw questions and answers are retained for 90 days by default, then the daily scheduler rolls their turn/token usage into permanent daily summaries and deletes the raw payloads. Clearing a conversation performs the same roll-up before removing its raw messages, so administrative usage and cost estimates are preserved. Set `ASK_NEST_HISTORY_RETENTION_DAYS` to a whole number from 30 to 3650 to change that period. Memories are retained, but no longer point to an expired conversation.

The `/api/cron/ask-nest-retention` scheduler route runs daily at 02:00 Singapore time (18:00 UTC) through `vercel.json`. It now consolidates bounded retention for Ask Nest, expired security grants/challenges, background jobs, raw alert bodies, invitations, notifications, audit logs, and provider caches. Credit-alert bodies are retained only when parsing fails, encrypted at rest, limited to 32,000 characters, visible only to workspace owners on `/credit-alerts`, and redacted after seven days by default. Set `CARD_ALERT_BODY_RETENTION_DAYS` to a whole number from 1 to 365 to change that window. The scheduler requires `Authorization: Bearer ${CRON_SECRET}` and fails closed if `CRON_SECRET` is not configured.

Finance tools remain read-only, rate-limited, and restricted to the authenticated active workspace. Azure requests use stateless Responses API calls and carry encrypted reasoning items only between the tool-call turns needed to answer the current question.

`MASSIVE_API_KEY` optionally enables adjusted end-of-day US stock history. Massive Basic traffic is cached for one hour and serialized to stay below five upstream calls per minute. `SERPAPI_API_KEY` optionally enables recent public Google News plus cited public financial research. Identical news searches are cached for one hour and general financial searches for 24 hours. `SERPAPI_MONTHLY_REQUEST_LIMIT` defaults to 200 to preserve a safety reserve within the 250-search free plan. Before each uncached search, Nest uses SerpApi's free Account API to verify the real remaining allowance, including usage outside Nest. Keep these variables server-only; do not use `NEXT_PUBLIC_` names. SerpApi requires the API key as its `api_key` request parameter, but the Vercel environment variable must be named `SERPAPI_API_KEY`.

Ask Nest never sends names, personal amounts, balances, transaction details, account names, or card details to public search. Financial research queries contain only the public topic and geography. Search snippets are treated as untrusted evidence and cited; official HTML pages can be read only from an allowlist of government, regulator, exchange, academic, and multilateral domains, with private-network and response-size protections. Public benchmarks remain separate from recorded Nest facts and deterministic CIO projections. The assistant can compare them qualitatively but does not provide personalized buy, sell, or hold recommendations.

The standard `npm run dev`, `npm run build`, and `npm run start` commands launch Next.js with Node's system CA support when the installed Node version provides it. This keeps HTTPS verification enabled while allowing server-side research calls to work behind Windows or enterprise TLS inspection that is trusted by the operating system.

Real-world category questions such as “How much did I spend on transport?” use deterministic transaction classification rather than sub-account names or vector search. High-confidence merchant and description matches form the confirmed total; ambiguous multi-service merchants such as a generic `Grab` or `Gojek` entry are reported separately as possible spending. The category layer also covers dining, groceries, utilities, housing, shopping, entertainment, healthcare, education, travel, insurance, personal care, childcare, pets, fees, taxes, gifts, and charity.

Run the checked-in Ask Nest routing and retrieval gate before changing prompts, tool schemas, or models:

```bash
npm run ai:eval
```

The golden set lives in `evals/ask-nest/golden.json` and covers tool choice plus questions that genuinely require unstructured retrieval. A failing gate exits non-zero.

### Optional Azure AI Search knowledge retrieval

Structured balances, totals, comparisons, and due dates always come from Azure SQL tools. Azure AI Search is optional and is used only for workspace notes or imported document passages. It requires all of these server-only settings:

```env
ASK_NEST_SEARCH_ENABLED="true"
ASK_NEST_SEARCH_EVAL_PASS="true"
AZURE_SEARCH_ENDPOINT="https://your-search-service.search.windows.net"
AZURE_SEARCH_INDEX="ask-nest-knowledge"
AZURE_SEARCH_SEMANTIC_CONFIGURATION="ask-nest-semantic"
# Optional local fallback. Prefer managed identity with Search Index Data Reader.
AZURE_SEARCH_QUERY_KEY="***"
```

`ASK_NEST_SEARCH_EVAL_PASS` is an explicit deployment gate: leave it unset until the indexed corpus passes a representative retrieval evaluation. The search index must expose retrievable `id`, `title`, `content`, `sourceType`, `sourceId`, and `sourceUrl` fields; filterable `workspaceId` and `userId` fields; a `contentVector` field with a configured query-time vectorizer; and the named semantic configuration. Ask Nest issues one hybrid keyword/vector query with a workspace-and-user prefilter. Query keys and managed-identity credentials stay server-side.

## Credit Card Payment Reminders

Credit card payment reminders are run by the single canonical Vercel cron route:

```bash
GET /api/cron/credit-card-payment-reminders
Authorization: Bearer ${CRON_SECRET}
```

`vercel.json` schedules this route once per day. It sends reminders for outstanding credit card statement balances 5 days, 3 days, and 1 day before the due date, on the due date, and every overdue day. Reminders stop once the statement balance is no longer outstanding. The route uses database-backed leases and daily idempotency keys, so retries and overlapping invocations do not duplicate email, push, or in-app notifications.

Required environment variables:

```env
CRON_SECRET="a-random-secret-of-at-least-32-characters"
AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING="***"
AZURE_EMAIL_SENDER="billing@example.com"
```

Optional environment variables:

```env
CREDIT_CARD_REMINDER_CURRENCY="SGD"
PAYMENT_REMINDER_MAX_DELIVERIES_PER_RUN="100"
```

Authenticate scheduler requests with:

```http
Authorization: Bearer ${CRON_SECRET}
```

Use `?dryRun=1` to count pending reminders without sending email.

## Reliable Background Jobs

Gmail sync, per-workspace credit-card auto-accounting, and reminder delivery use SQL-backed jobs. Active scopes and delivery idempotency keys are protected by filtered unique indexes; workers claim jobs with expiring lease tokens and checkpoint resumable work. Retryable failures use bounded exponential backoff and eventually move to `DEAD_LETTER`. Administrators can inspect queue age, attempts, sanitized failures, and retry/cancel eligible jobs from `/admin`.

Gmail reads at most a configured number of messages per leased slice and persists Gmail history cursors. Manual requests await one bounded slice; remaining pages stay queued for `/api/cron/gmail-sync` or another manual invocation.

```env
GMAIL_SYNC_MESSAGES_PER_SLICE="50"
GMAIL_SYNC_SLICES_PER_INVOCATION="4"
```

Deploy the additive Phase 5 schema before deploying code that uses the new queue fields:

```bash
npm run prisma:migrate:deploy
```

## Legacy Mapping Notes

The new Prisma schema keeps migration traceability through `LegacyRecordLink`.

Legacy to new model mapping highlights:

- `Transactions_Main` -> `Transaction`
- `AccountTypes` -> `AccountType`
- `Budget` -> `BudgetEnvelope`
- `ExpenseType` -> `ExpenseType`
- `Expense` -> `Expense`
- `CCName` -> `CreditCardAccount`
- `Interface_CC_Transactions` + `CCdebts` -> `CreditCardTxnLink` + `Transaction`
- `Receivables` -> `Receivable`
- `Months` -> `Month`
- `NoteLists` + `Notes` -> `NoteList` + `Note`
- `KFMiles*` tables -> `MileProgram`, `MileRedemption`, `MileRedemptionDetail`

`LegacyRecordLink` stores `(system, sourceTable, sourceId)` to `(targetModel, targetId)` so import scripts can be rerun idempotently.

## Auth Notes

NextAuth providers are conditionally enabled when env values exist:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET`
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`

OAuth accounts are linked only through an authenticated, explicit action after verified provider claims.

Gmail access and refresh tokens are stored as versioned AES-256-GCM envelopes. Configure a 32-byte base64 key before enabling the Gmail integration:

```env
INTEGRATION_ENCRYPTION_KEY="..."
INTEGRATION_ENCRYPTION_KEY_VERSION="v1"
INTEGRATION_ENCRYPTION_PREVIOUS_KEYS="{}"
```

The Phase 3 security migration clears legacy plaintext Gmail grants, so existing users reconnect once after deployment. It also removes legacy full-card fields; Nest retains only card name/bank, last four digits, and expiry. See [the security architecture](docs/architecture/security.md) for credential rotation and deployment guidance.

### Passkeys and Web Push

Passkeys use the application origin by default. Production deployments should set explicit relying-party values:

```env
WEBAUTHN_RP_NAME="Nest"
WEBAUTHN_RP_ID="nest.example.com"
WEBAUTHN_ORIGIN="https://nest.example.com"
```

Generate VAPID keys for optional device notifications:

```bash
npm run vapid:generate
```

Store the generated values in the deployment environment:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VAPID_SUBJECT="mailto:admin@example.com"
```

Apply the `phase_3_device_integration` migration before enabling passkeys or push subscriptions. Users can install Nest, manage passkeys, and opt into supported notifications from Settings. Financial mutations are never queued by the service worker while offline.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma SQL Server docs](https://www.prisma.io/docs/orm/overview/databases/sql-server)
- [NextAuth docs](https://next-auth.js.org/)

## Contributing and Security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report
vulnerabilities privately using [SECURITY.md](SECURITY.md).

## License

No open-source license has been selected yet. Until a license is added, the
source is publicly viewable if the repository is made public, but normal
copyright restrictions still apply.
