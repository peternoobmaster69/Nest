# Nest

Nest is a personal finance web application focused on:

- Virtual budget accounts (envelope style)
- Credit card tracking with encrypted sensitive fields (AES-256-GCM)
- Receivables and shared-workspace collaboration
- Legacy migration from the existing schema in [`public/LegacyAppDbSchema.png`](public/LegacyAppDbSchema.png)

Stack:

- Next.js + React + TypeScript
- Tailwind CSS
- Prisma ORM + Azure SQL (`sqlserver`)
- NextAuth (Apple, Google, Facebook providers)
- React Query for client data fetching

## Getting Started

1. Copy environment variables and fill values:

```bash
cp .env.example .env
```

`DATABASE_URL` can be just the Azure SQL host, for example:

```env
DATABASE_URL="spocdevdbs1.database.windows.net"
AZURE_SQL_DATABASE="nest"
AZURE_SQL_USER="app_user"
AZURE_SQL_PASSWORD="***"
AZURE_SQL_ENCRYPT="true"
AZURE_SQL_TRUST_SERVER_CERTIFICATE="false"
```

Nest and Prisma scripts will construct the full SQL Server URL automatically.

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

5. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

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
CRON_SECRET="a-long-random-secret"
```

`AI_WORKLOAD_ENDPOINT` may be the Azure OpenAI resource root or its `/openai/v1/` base URL. `AI_WORKLOAD_MODEL` must be the Azure deployment name and must support the Responses API, function calling, and structured outputs. Restart the application after changing environment variables.

`ADMIN` is the single email address allowed to open `/admin`. The comparison is case-insensitive and the route is unavailable when `ADMIN` is missing.

Set the optional token-rate variables to your Azure deployment's current USD prices. The admin page uses them to estimate Ask Nest cost from recorded input/output tokens; it does not replace Azure billing and does not account for deployment-specific discounts or surcharges.

Ask Nest history and user-approved memory are persisted per user and workspace. Raw questions and answers are retained for 90 days by default, then the daily scheduler rolls their turn/token usage into permanent daily summaries and deletes the raw payloads. Clearing a conversation performs the same roll-up before removing its raw messages, so administrative usage and cost estimates are preserved. Set `ASK_NEST_HISTORY_RETENTION_DAYS` to a whole number from 30 to 3650 to change that period. Memories are retained, but no longer point to an expired conversation.

The `/api/cron/ask-nest-retention` scheduler route runs daily at 02:00 Singapore time (18:00 UTC) through `vercel.json`. It requires `Authorization: Bearer ${CRON_SECRET}` and fails closed if `CRON_SECRET` is not configured.

Finance tools remain read-only, rate-limited, and restricted to the authenticated active workspace. Azure requests use stateless Responses API calls and carry encrypted reasoning items only between the tool-call turns needed to answer the current question.

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

Credit card payment reminder emails are sent by calling:

```bash
POST /api/credit-card-payment-reminders
```

Schedule this endpoint to run once per day. It sends reminders for outstanding credit card statement balances that are due in the next 3 days or already overdue, and stops once the statement balance is no longer outstanding.

Required environment variables:

```env
CREDIT_CARD_REMINDER_SECRET="***"
RESEND_API_KEY="***"
CREDIT_CARD_REMINDER_FROM="Nest <billing@example.com>"
```

Optional environment variables:

```env
CREDIT_CARD_REMINDER_CURRENCY="SGD"
APP_URL="https://your-app.example.com"
```

Authenticate scheduler requests with either:

```http
Authorization: Bearer ${CREDIT_CARD_REMINDER_SECRET}
```

or:

```http
x-cron-secret: ${CREDIT_CARD_REMINDER_SECRET}
```

Use `?dryRun=1` to count pending reminders without sending email.

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

`allowDangerousEmailAccountLinking` is enabled for provider-based account merge by verified email.

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
