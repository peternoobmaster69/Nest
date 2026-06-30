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

## Credit Card Payment Reminders

Credit card payment reminders are sent by a protected cron endpoint:

```bash
POST /api/credit-card-payment-reminders/run
Authorization: Bearer $CRON_SECRET
```

Configure a daily scheduler to call the endpoint and set these environment variables:

```env
CRON_SECRET="***"
RESEND_API_KEY="***"
EMAIL_FROM="Nest <notifications@example.com>"
```

The job emails workspace members when a credit card statement has a positive outstanding balance and the payment due date is within 3 days or already overdue. A reminder is recorded in `BackgroundJob` so the same statement is emailed at most once per day, and daily reminders continue until the outstanding balance is no longer positive.

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

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma SQL Server docs](https://www.prisma.io/docs/orm/overview/databases/sql-server)
- [NextAuth docs](https://next-auth.js.org/)
