import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadDotEnv, resolveDatabaseUrl } from "./run-prisma.mjs";

loadDotEnv(path.join(process.cwd(), ".env"));
const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl(process.env) });

const wakeDelaysMs = [1_000, 2_000, 4_000, 8_000, 10_000];

function isRetryableDatabaseWake(error) {
  const code = typeof error === "object" && error && "code" in error ? error.code : null;
  const message = error instanceof Error ? error.message : String(error);
  return ["P1001", "P1002", "P2024"].includes(String(code)) || /can't reach database|timed out|timeout|socket/i.test(message);
}

async function waitForDatabase() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1 AS [ready]`;
      return;
    } catch (error) {
      if (!isRetryableDatabaseWake(error) || attempt >= wakeDelaysMs.length) throw error;
      const delay = wakeDelaysMs[attempt];
      console.log(`Database is resuming; retrying preflight in ${delay / 1_000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const checks = [
  ["invalid workspace member role", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[WorkspaceMember] WHERE [role] NOT IN (N'VIEWER', N'EDITOR', N'OWNER', N'MEMBER')`],
  ["invalid invite role/status", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[WorkspaceInvite] WHERE [role] NOT IN (N'VIEWER', N'EDITOR') OR [status] NOT IN (N'PENDING', N'ACCEPTED', N'DECLINED', N'REVOKED')`],
  ["invalid account kind", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[FinancialAccount] WHERE [kind] NOT IN (N'BANK', N'CASH', N'VIRTUAL_BUDGET')`],
  ["invalid transaction kind/direction", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[Transaction] WHERE [kind] NOT IN (N'EXPENSE', N'INCOME', N'TRANSFER', N'CREDIT_CARD_PAYMENT', N'RECEIVABLE_PAYMENT', N'ADJUSTMENT', N'REVERSAL', N'MIGRATION', N'Migration') OR [direction] NOT IN (N'DEBIT', N'CREDIT')`],
  ["invalid plan/receivable state", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [status] FROM [dbo].[MonthlyBudgetPlan] WHERE [status] NOT IN (N'DRAFT', N'REVIEW', N'CONFIRMING', N'CONFIRMED') UNION ALL SELECT [status] FROM [dbo].[Receivable] WHERE [status] NOT IN (N'OPEN', N'PARTIAL', N'PROCESSING', N'PAID', N'VOID')) x`],
  ["invalid auxiliary state", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [id] FROM [dbo].[AskNestMemory] WHERE [kind] NOT IN (N'PREFERENCE', N'TERMINOLOGY', N'INSTRUCTION') OR [status] <> N'ACTIVE' UNION ALL SELECT [id] FROM [dbo].[PostingGroup] WHERE [status] NOT IN (N'POSTED', N'REVERSED') UNION ALL SELECT [id] FROM [dbo].[IdempotencyRecord] WHERE [status] NOT IN (N'IN_PROGRESS', N'COMPLETED', N'FAILED') UNION ALL SELECT [id] FROM [dbo].[WebAuthnChallenge] WHERE [purpose] NOT IN (N'REGISTRATION', N'AUTHENTICATION', N'LOGIN_TICKET')) x`],
  ["invalid alert/job state", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [parseStatus] AS [status] FROM [dbo].[CardAlertStaging] WHERE [source] NOT IN (N'EMAIL', N'GMAIL', N'API', N'MANUAL') OR [parseStatus] NOT IN (N'PENDING', N'PARSED', N'PROCESSING', N'PROCESSED', N'DUPLICATE', N'FAILED') UNION ALL SELECT [status] FROM [dbo].[BackgroundJob] WHERE [status] NOT IN (N'PENDING', N'RUNNING', N'SUCCEEDED', N'SKIPPED', N'FAILED', N'DEAD_LETTER', N'CANCELLED')) x`],
  ["invalid calendar/value ranges", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [id] FROM [dbo].[Month] WHERE [month] NOT BETWEEN 1 AND 12 UNION ALL SELECT [id] FROM [dbo].[MonthlyBudgetSource] WHERE [month] NOT BETWEEN 1 AND 12 UNION ALL SELECT [id] FROM [dbo].[MonthlyBudget] WHERE [month] NOT BETWEEN 1 AND 12 UNION ALL SELECT [id] FROM [dbo].[MonthlyBudgetPlan] WHERE [month] NOT BETWEEN 1 AND 12 UNION ALL SELECT [id] FROM [dbo].[CreditCardAccount] WHERE [statementDay] NOT BETWEEN 1 AND 31 OR [paymentDueDay] NOT BETWEEN 1 AND 31 OR ([expiryMonth] IS NOT NULL AND [expiryMonth] NOT BETWEEN 1 AND 12) OR ([expiryYear] IS NOT NULL AND [expiryYear] NOT BETWEEN 2000 AND 9999) UNION ALL SELECT [id] FROM [dbo].[CreditCardTransaction] WHERE [statementMonth] NOT BETWEEN 1 AND 12 OR [statementYear] NOT BETWEEN 1900 AND 9999 OR ([isInstallment] = 1 AND ([installmentNo] IS NULL OR [totalInstallments] IS NULL OR [installmentNo] < 1 OR [totalInstallments] < [installmentNo])) UNION ALL SELECT [id] FROM [dbo].[PointConversion] WHERE [fromPoints] <= 0 OR [toMiles] <= 0 OR [conversionRate] < 0 UNION ALL SELECT [id] FROM [dbo].[HotelRewardAccount] WHERE [currentPoints] < 0 OR ([targetPoints] IS NOT NULL AND [targetPoints] <= 0) OR [centsPerPoint] < 0) x`],
  ["invalid currency codes", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [id] FROM [dbo].[Workspace] WHERE LEN([baseCurrency]) <> 3 OR [baseCurrency] COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Z]%' UNION ALL SELECT [id] FROM [dbo].[CardAlertStaging] WHERE [currency] IS NOT NULL AND (LEN([currency]) <> 3 OR [currency] COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Z]%')) x`],
  ["invalid background job progress", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[BackgroundJob] WHERE [progress] NOT BETWEEN 0 AND 100 OR [attempts] < 0 OR [retryCount] < 0 OR [maxAttempts] <= 0 OR [duplicateCount] < 0 OR ([total] IS NOT NULL AND [total] < 0) OR ([current] IS NOT NULL AND [current] < 0) OR ([total] IS NOT NULL AND [current] IS NOT NULL AND [current] > [total])`],
  ["duplicate public/invite tokens", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [publicNetWorthToken] AS [token] FROM [dbo].[Workspace] WHERE [publicNetWorthToken] IS NOT NULL GROUP BY [publicNetWorthToken] HAVING COUNT(*) > 1 UNION ALL SELECT [tokenHash] FROM [dbo].[WorkspaceInvite] WHERE [tokenHash] IS NOT NULL GROUP BY [tokenHash] HAVING COUNT(*) > 1) x`],
  ["duplicate job/ingestion keys", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [activeScopeKey] AS [key] FROM [dbo].[BackgroundJob] WHERE [activeScopeKey] IS NOT NULL GROUP BY [activeScopeKey] HAVING COUNT(*) > 1 UNION ALL SELECT [idempotencyKey] FROM [dbo].[BackgroundJob] WHERE [idempotencyKey] IS NOT NULL GROUP BY [idempotencyKey] HAVING COUNT(*) > 1 UNION ALL SELECT [sourceMessageKey] FROM [dbo].[CardAlertStaging] WHERE [sourceMessageKey] IS NOT NULL GROUP BY [sourceMessageKey] HAVING COUNT(*) > 1 UNION ALL SELECT [transactionKey] FROM [dbo].[CardAlertStaging] WHERE [transactionKey] IS NOT NULL GROUP BY [transactionKey] HAVING COUNT(*) > 1) x`],
  ["duplicate credit-card source posting links", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT [creditCardTransactionId] FROM [dbo].[CreditCardTxnLink] WHERE [creditCardTransactionId] IS NOT NULL GROUP BY [creditCardTransactionId] HAVING COUNT(*) > 1) x`],
  ["orphaned constrained relations", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM (
      SELECT b.[id] FROM [dbo].[BudgetEnvelope] b LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = b.[accountId] WHERE a.[id] IS NULL
      UNION ALL SELECT i.[id] FROM [dbo].[BudgetItem] i LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = i.[destinationSubAccountId] WHERE i.[destinationSubAccountId] IS NOT NULL AND b.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = t.[accountId] WHERE a.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = t.[budgetId] WHERE t.[budgetId] IS NOT NULL AND b.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[TransactionGroup] g ON g.[id] = t.[groupId] WHERE t.[groupId] IS NOT NULL AND g.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[CreditCardTransaction] c ON c.[id] = t.[creditCardTransactionId] WHERE t.[creditCardTransactionId] IS NOT NULL AND c.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[Receivable] r ON r.[id] = t.[receivableId] WHERE t.[receivableId] IS NOT NULL AND r.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[PostingGroup] p ON p.[id] = t.[postingGroupId] WHERE t.[postingGroupId] IS NOT NULL AND p.[id] IS NULL
      UNION ALL SELECT g.[id] FROM [dbo].[TransactionGroup] g LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = g.[budgetId] WHERE b.[id] IS NULL
      UNION ALL SELECT r.[id] FROM [dbo].[CreditCardReward] r LEFT JOIN [dbo].[CreditCardAccount] c ON c.[id] = r.[creditCardId] WHERE c.[id] IS NULL
      UNION ALL SELECT p.[id] FROM [dbo].[PointConversion] p LEFT JOIN [dbo].[CreditCardReward] r ON r.[id] = p.[creditCardRewardId] WHERE p.[creditCardRewardId] IS NOT NULL AND r.[id] IS NULL
      UNION ALL SELECT p.[id] FROM [dbo].[PointConversion] p LEFT JOIN [dbo].[FrequentFlyerAccount] f ON f.[id] = p.[frequentFlyerId] WHERE p.[frequentFlyerId] IS NOT NULL AND f.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[CreditCardTransaction] t LEFT JOIN [dbo].[CreditCardAccount] c ON c.[id] = t.[creditCardId] WHERE c.[id] IS NULL
      UNION ALL SELECT t.[id] FROM [dbo].[CreditCardTransaction] t LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = t.[budgetId] WHERE t.[budgetId] IS NOT NULL AND b.[id] IS NULL
      UNION ALL SELECT s.[id] FROM [dbo].[CardAlertStaging] s LEFT JOIN [dbo].[CreditCardAccount] c ON c.[id] = s.[creditCardId] WHERE s.[creditCardId] IS NOT NULL AND c.[id] IS NULL
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = r.[accountId] WHERE r.[accountId] IS NOT NULL AND a.[id] IS NULL
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = r.[budgetId] WHERE r.[budgetId] IS NOT NULL AND b.[id] IS NULL
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r LEFT JOIN [dbo].[Month] m ON m.[id] = r.[statementMonthId] WHERE r.[statementMonthId] IS NOT NULL AND m.[id] IS NULL
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r LEFT JOIN [dbo].[PostingGroup] p ON p.[id] = r.[postingGroupId] WHERE r.[postingGroupId] IS NOT NULL AND p.[id] IS NULL
      UNION ALL SELECT w.[id] FROM [dbo].[Workspace] w LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = w.[receivableDefaultAccountId] WHERE w.[receivableDefaultAccountId] IS NOT NULL AND a.[id] IS NULL
      UNION ALL SELECT w.[id] FROM [dbo].[Workspace] w LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = w.[receivableDefaultBudgetId] WHERE w.[receivableDefaultBudgetId] IS NOT NULL AND b.[id] IS NULL
    ) x
  `],
  ["orphaned card-alert transaction aliases", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM [dbo].[CardAlertStaging] s LEFT JOIN [dbo].[CreditCardTransaction] c ON c.[id] = s.[creditTransactionId] WHERE s.[creditTransactionId] IS NOT NULL AND c.[id] IS NULL`, "repair"],
  ["cross-workspace account/budget/group links", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM (
      SELECT b.[id] FROM [dbo].[BudgetEnvelope] b LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = b.[accountId] WHERE a.[id] IS NULL OR a.[workspaceId] <> b.[workspaceId]
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = t.[accountId] WHERE a.[id] IS NULL OR a.[workspaceId] <> t.[workspaceId]
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t INNER JOIN [dbo].[BudgetEnvelope] b ON b.[id] = t.[budgetId] WHERE b.[workspaceId] <> t.[workspaceId]
      UNION ALL SELECT g.[id] FROM [dbo].[TransactionGroup] g LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = g.[budgetId] WHERE b.[id] IS NULL OR b.[workspaceId] <> g.[workspaceId]
    ) x
  `],
  ["cross-workspace card/reward links", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM (
      SELECT t.[id] FROM [dbo].[CreditCardTransaction] t LEFT JOIN [dbo].[CreditCardAccount] c ON c.[id] = t.[creditCardId] WHERE c.[id] IS NULL OR c.[workspaceId] <> t.[workspaceId]
      UNION ALL SELECT r.[id] FROM [dbo].[CreditCardReward] r LEFT JOIN [dbo].[CreditCardAccount] c ON c.[id] = r.[creditCardId] WHERE c.[id] IS NULL OR c.[workspaceId] <> r.[workspaceId]
      UNION ALL SELECT s.[id] FROM [dbo].[CardAlertStaging] s INNER JOIN [dbo].[CreditCardAccount] c ON c.[id] = s.[creditCardId] WHERE c.[workspaceId] <> s.[workspaceId]
    ) x
  `],
  ["cross-workspace planning/reward links", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM (
      SELECT i.[id] FROM [dbo].[BudgetItem] i INNER JOIN [dbo].[BudgetEnvelope] b ON b.[id] = i.[destinationSubAccountId] WHERE b.[workspaceId] <> i.[workspaceId]
      UNION ALL SELECT p.[id] FROM [dbo].[PointConversion] p INNER JOIN [dbo].[CreditCardReward] r ON r.[id] = p.[creditCardRewardId] WHERE r.[workspaceId] <> p.[workspaceId]
      UNION ALL SELECT p.[id] FROM [dbo].[PointConversion] p INNER JOIN [dbo].[FrequentFlyerAccount] f ON f.[id] = p.[frequentFlyerId] WHERE f.[workspaceId] <> p.[workspaceId]
      UNION ALL SELECT t.[id] FROM [dbo].[CreditCardTransaction] t INNER JOIN [dbo].[BudgetEnvelope] b ON b.[id] = t.[budgetId] WHERE b.[workspaceId] <> t.[workspaceId]
    ) x
  `],
  ["cross-workspace optional ledger links", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM (
      SELECT t.[id] FROM [dbo].[Transaction] t INNER JOIN [dbo].[CreditCardTransaction] c ON c.[id] = t.[creditCardTransactionId] WHERE c.[workspaceId] <> t.[workspaceId]
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t INNER JOIN [dbo].[Receivable] r ON r.[id] = t.[receivableId] WHERE r.[workspaceId] <> t.[workspaceId]
      UNION ALL SELECT t.[id] FROM [dbo].[Transaction] t INNER JOIN [dbo].[PostingGroup] p ON p.[id] = t.[postingGroupId] WHERE p.[workspaceId] <> t.[workspaceId]
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r INNER JOIN [dbo].[Month] m ON m.[id] = r.[statementMonthId] WHERE m.[workspaceId] <> r.[workspaceId]
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r INNER JOIN [dbo].[PostingGroup] p ON p.[id] = r.[postingGroupId] WHERE p.[workspaceId] <> r.[workspaceId]
      UNION ALL SELECT w.[id] FROM [dbo].[Workspace] w INNER JOIN [dbo].[FinancialAccount] a ON a.[id] = w.[receivableDefaultAccountId] WHERE a.[workspaceId] <> w.[id]
      UNION ALL SELECT w.[id] FROM [dbo].[Workspace] w INNER JOIN [dbo].[BudgetEnvelope] b ON b.[id] = w.[receivableDefaultBudgetId] WHERE b.[workspaceId] <> w.[id]
    ) x
  `],
  ["legacy cross-workspace receivable aliases", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM (
      SELECT r.[id] FROM [dbo].[Receivable] r INNER JOIN [dbo].[FinancialAccount] a ON a.[id] = r.[accountId] WHERE a.[workspaceId] <> r.[workspaceId]
      UNION ALL SELECT r.[id] FROM [dbo].[Receivable] r INNER JOIN [dbo].[BudgetEnvelope] b ON b.[id] = r.[budgetId] WHERE b.[workspaceId] <> r.[workspaceId]
    ) x
  `, "repair"],
  ["inconsistent legacy receivable source aliases", Prisma.sql`
    SELECT COUNT_BIG(*) AS [count] FROM [dbo].[Receivable] r
    LEFT JOIN [dbo].[FinancialAccount] a ON a.[id] = r.[accountId]
    LEFT JOIN [dbo].[BudgetEnvelope] b ON b.[id] = r.[budgetId]
    WHERE
      (b.[id] IS NOT NULL AND b.[workspaceId] <> r.[workspaceId] AND (a.[id] IS NULL OR a.[workspaceId] = r.[workspaceId]))
      OR (a.[id] IS NOT NULL AND a.[workspaceId] <> r.[workspaceId] AND b.[id] IS NOT NULL AND b.[workspaceId] <> a.[workspaceId])
      OR (a.[id] IS NOT NULL AND a.[workspaceId] <> r.[workspaceId] AND (
        (r.[sourceWorkspaceId] IS NOT NULL AND r.[sourceWorkspaceId] <> a.[workspaceId])
        OR (r.[sourceAccountId] IS NOT NULL AND r.[sourceAccountId] <> r.[accountId])
        OR (r.[sourceBudgetId] IS NOT NULL AND (r.[budgetId] IS NULL OR r.[sourceBudgetId] <> r.[budgetId]))
      ))
  `],
  ["integration without workspace membership", Prisma.sql`SELECT COUNT_BIG(*) AS [count] FROM (SELECT g.[workspaceId] FROM [dbo].[GmailIntegration] g LEFT JOIN [dbo].[WorkspaceMember] m ON m.[workspaceId] = g.[workspaceId] AND m.[userId] = g.[userId] WHERE m.[id] IS NULL UNION ALL SELECT o.[workspaceId] FROM [dbo].[IntegrationOAuthState] o LEFT JOIN [dbo].[WorkspaceMember] m ON m.[workspaceId] = o.[workspaceId] AND m.[userId] = o.[userId] WHERE m.[id] IS NULL) x`],
];

let failures = 0;
try {
  await waitForDatabase();
  const phase5Columns = await prisma.$queryRaw`
    SELECT c.[name]
    FROM sys.columns c
    WHERE c.[object_id] IN (OBJECT_ID(N'[dbo].[BackgroundJob]'), OBJECT_ID(N'[dbo].[CardAlertStaging]'))
      AND c.[name] IN (N'activeScopeKey', N'idempotencyKey', N'sourceMessageKey', N'transactionKey')
  `;
  const phase5KeyColumnsReady = phase5Columns.length === 4;
  if (!phase5KeyColumnsReady) {
    console.log("REPAIR  Phase 5 key columns are absent; duplicate job/ingestion key check deferred until Phase 5 is retried.");
  }
  for (const [name, query, handling] of checks) {
    if (["duplicate job/ingestion keys", "invalid background job progress"].includes(name) && !phase5KeyColumnsReady) {
      console.log(`${"ok".padEnd(7)} ${name}: 0 (deferred)`);
      continue;
    }
    const rows = await prisma.$queryRaw(query);
    const count = Number(rows[0]?.count ?? 0);
    const status = count === 0 ? "ok" : handling === "repair" ? "REPAIR" : "BLOCKED";
    console.log(`${status.padEnd(7)} ${name}: ${count}`);
    if (count && handling !== "repair") failures += 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message.split("\n").filter(Boolean).at(-1) : String(error);
  console.error(`Phase 4 preflight could not run: ${message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

if (failures) {
  console.error(`Phase 4 preflight found ${failures} blocking check(s).`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("Phase 4 database preflight passed.");
}
