-- Phase 4: reproducible schema, constrained domain values, scoped references, and retention.
-- This is intentionally a forward migration. Existing migrations are retained byte-for-byte.

SET XACT_ABORT ON;

BEGIN TRY
BEGIN TRANSACTION;

-- Reconcile Phase 5 drift observed in an environment where its migration was
-- recorded as applied but the physical columns were absent. Every operation is
-- idempotent so correctly migrated databases are unchanged.
IF COL_LENGTH(N'dbo.CardAlertStaging', N'sourceMessageKey') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [sourceMessageKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.CardAlertStaging', N'transactionKey') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [transactionKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.CardAlertStaging', N'contentHash') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [contentHash] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.CardAlertStaging', N'processingStartedAt') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [processingStartedAt] DATETIME2 NULL;

IF COL_LENGTH(N'dbo.BackgroundJob', N'activeScopeKey') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [activeScopeKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'idempotencyKey') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [idempotencyKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'payloadJson') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [payloadJson] NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'checkpointJson') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [checkpointJson] NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'errorCode') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [errorCode] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'attempts') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [attempts] INT NOT NULL CONSTRAINT [BackgroundJob_attempts_phase4_df] DEFAULT 0;
IF COL_LENGTH(N'dbo.BackgroundJob', N'retryCount') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [retryCount] INT NOT NULL CONSTRAINT [BackgroundJob_retryCount_phase4_df] DEFAULT 0;
IF COL_LENGTH(N'dbo.BackgroundJob', N'maxAttempts') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [maxAttempts] INT NOT NULL CONSTRAINT [BackgroundJob_maxAttempts_phase4_df] DEFAULT 5;
IF COL_LENGTH(N'dbo.BackgroundJob', N'duplicateCount') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [duplicateCount] INT NOT NULL CONSTRAINT [BackgroundJob_duplicateCount_phase4_df] DEFAULT 0;
IF COL_LENGTH(N'dbo.BackgroundJob', N'availableAt') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [availableAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_availableAt_phase4_df] DEFAULT CURRENT_TIMESTAMP;
IF COL_LENGTH(N'dbo.BackgroundJob', N'leaseToken') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [leaseToken] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'cancelRequestedAt') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [cancelRequestedAt] DATETIME2 NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'deadLetteredAt') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [deadLetteredAt] DATETIME2 NULL;

-- Defer statements that refer to reconciled columns. SQL Server otherwise binds
-- their names before the conditional ALTER TABLE statements above execute.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_sourceMessageKey_idx') EXEC(N'CREATE INDEX [CardAlertStaging_sourceMessageKey_idx] ON [dbo].[CardAlertStaging]([sourceMessageKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_transactionKey_idx') EXEC(N'CREATE INDEX [CardAlertStaging_transactionKey_idx] ON [dbo].[CardAlertStaging]([transactionKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_activeScopeKey_idx') EXEC(N'CREATE INDEX [BackgroundJob_activeScopeKey_idx] ON [dbo].[BackgroundJob]([activeScopeKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_idempotencyKey_idx') EXEC(N'CREATE INDEX [BackgroundJob_idempotencyKey_idx] ON [dbo].[BackgroundJob]([idempotencyKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_status_availableAt_idx') EXEC(N'CREATE INDEX [BackgroundJob_status_availableAt_idx] ON [dbo].[BackgroundJob]([status], [availableAt])');

-- These jobs predate durable leases and can otherwise remain RUNNING forever.
EXEC(N'UPDATE [dbo].[BackgroundJob]
SET [status] = N''PENDING'', [availableAt] = SYSUTCDATETIME(), [lockedAt] = NULL,
    [leaseExpiresAt] = NULL, [startedAt] = NULL, [message] = N''Recovered from legacy non-durable lease''
WHERE [status] = N''RUNNING'' AND [leaseToken] IS NULL');

-- Preserve the historical MEMBER meaning before roles become constrained.
UPDATE [dbo].[WorkspaceMember] SET [role] = N'EDITOR' WHERE [role] = N'MEMBER';
UPDATE [dbo].[Transaction] SET [kind] = N'MIGRATION' WHERE [kind] = N'Migration';

-- Fail with an actionable message instead of silently rewriting unknown domain values.
IF EXISTS (SELECT 1 FROM [dbo].[WorkspaceMember] WHERE [role] NOT IN (N'VIEWER', N'EDITOR', N'OWNER'))
  THROW 51000, 'Phase 4 preflight: WorkspaceMember contains an invalid role.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[WorkspaceInvite] WHERE [role] NOT IN (N'VIEWER', N'EDITOR'))
  THROW 51000, 'Phase 4 preflight: WorkspaceInvite contains an invalid role.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[WorkspaceInvite] WHERE [status] NOT IN (N'PENDING', N'ACCEPTED', N'DECLINED', N'REVOKED'))
  THROW 51000, 'Phase 4 preflight: WorkspaceInvite contains an invalid status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[FinancialAccount] WHERE [kind] NOT IN (N'BANK', N'CASH', N'VIRTUAL_BUDGET'))
  THROW 51000, 'Phase 4 preflight: FinancialAccount contains an invalid kind.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[Transaction] WHERE [kind] NOT IN (N'EXPENSE', N'INCOME', N'TRANSFER', N'CREDIT_CARD_PAYMENT', N'RECEIVABLE_PAYMENT', N'ADJUSTMENT', N'REVERSAL', N'MIGRATION'))
  THROW 51000, 'Phase 4 preflight: Transaction contains an invalid kind.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[Transaction] WHERE [direction] NOT IN (N'DEBIT', N'CREDIT'))
  THROW 51000, 'Phase 4 preflight: Transaction contains an invalid direction.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[MonthlyBudgetPlan] WHERE [status] NOT IN (N'DRAFT', N'REVIEW', N'CONFIRMED'))
  THROW 51000, 'Phase 4 preflight: MonthlyBudgetPlan contains an invalid status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[AskNestMemory] WHERE [kind] NOT IN (N'PREFERENCE', N'TERMINOLOGY', N'INSTRUCTION') OR [status] <> N'ACTIVE')
  THROW 51000, 'Phase 4 preflight: AskNestMemory contains an invalid kind or status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[PostingGroup] WHERE [status] NOT IN (N'POSTED', N'REVERSED'))
  THROW 51000, 'Phase 4 preflight: PostingGroup contains an invalid status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[IdempotencyRecord] WHERE [status] NOT IN (N'IN_PROGRESS', N'COMPLETED', N'FAILED'))
  THROW 51000, 'Phase 4 preflight: IdempotencyRecord contains an invalid status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[Receivable] WHERE [status] NOT IN (N'OPEN', N'PARTIAL', N'PROCESSING', N'PAID', N'VOID'))
  THROW 51000, 'Phase 4 preflight: Receivable contains an invalid status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[CardAlertStaging] WHERE [source] NOT IN (N'EMAIL', N'GMAIL', N'API', N'MANUAL') OR [parseStatus] NOT IN (N'PENDING', N'PARSED', N'PROCESSING', N'PROCESSED', N'DUPLICATE', N'FAILED'))
  THROW 51000, 'Phase 4 preflight: CardAlertStaging contains an invalid source or parse status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[BackgroundJob] WHERE [status] NOT IN (N'PENDING', N'RUNNING', N'SUCCEEDED', N'SKIPPED', N'FAILED', N'DEAD_LETTER', N'CANCELLED'))
  THROW 51000, 'Phase 4 preflight: BackgroundJob contains an invalid status.', 1;
IF EXISTS (SELECT 1 FROM [dbo].[WebAuthnChallenge] WHERE [purpose] NOT IN (N'REGISTRATION', N'AUTHENTICATION', N'LOGIN_TICKET'))
  THROW 51000, 'Phase 4 preflight: WebAuthnChallenge contains an invalid purpose.', 1;

-- Use fixed precision for rates that participate in value calculations. This must
-- run before check constraints are attached to the converted columns.
IF EXISTS (
  SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
  WHERE c.object_id = OBJECT_ID(N'[dbo].[HotelRewardAccount]') AND c.[name] = N'centsPerPoint' AND t.[name] = N'float'
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID(N'[dbo].[HotelRewardAccount]') AND [name] = N'HotelRewardAccount_centsPerPoint_df')
    ALTER TABLE [dbo].[HotelRewardAccount] DROP CONSTRAINT [HotelRewardAccount_centsPerPoint_df];
  ALTER TABLE [dbo].[HotelRewardAccount] ALTER COLUMN [centsPerPoint] DECIMAL(19, 8) NOT NULL;
  ALTER TABLE [dbo].[HotelRewardAccount] ADD CONSTRAINT [HotelRewardAccount_centsPerPoint_df] DEFAULT 0 FOR [centsPerPoint];
END;
IF EXISTS (
  SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
  WHERE c.object_id = OBJECT_ID(N'[dbo].[PointConversion]') AND c.[name] = N'conversionRate' AND t.[name] = N'float'
)
  ALTER TABLE [dbo].[PointConversion] ALTER COLUMN [conversionRate] DECIMAL(19, 8) NOT NULL;

-- Phase 1 intentionally used bounded identifiers, while these two parent tables
-- retain Prisma's historical NVARCHAR(1000) IDs. Widen the nullable child fields
-- to match their parents so SQL Server can enforce the relationships.
IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[Transaction]') AND [name] = N'creditCardTransactionId' AND [max_length] = 382)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE [object_id] = OBJECT_ID(N'[dbo].[Transaction]') AND [name] = N'Transaction_creditCardTransactionId_idx') DROP INDEX [Transaction_creditCardTransactionId_idx] ON [dbo].[Transaction];
  ALTER TABLE [dbo].[Transaction] ALTER COLUMN [creditCardTransactionId] NVARCHAR(1000) NULL;
  CREATE INDEX [Transaction_creditCardTransactionId_idx] ON [dbo].[Transaction]([creditCardTransactionId]);
END;
IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[Transaction]') AND [name] = N'receivableId' AND [max_length] = 382)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE [object_id] = OBJECT_ID(N'[dbo].[Transaction]') AND [name] = N'Transaction_receivableId_idx') DROP INDEX [Transaction_receivableId_idx] ON [dbo].[Transaction];
  ALTER TABLE [dbo].[Transaction] ALTER COLUMN [receivableId] NVARCHAR(1000) NULL;
  CREATE INDEX [Transaction_receivableId_idx] ON [dbo].[Transaction]([receivableId]);
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'WorkspaceMember_role_check')
  ALTER TABLE [dbo].[WorkspaceMember] WITH CHECK ADD CONSTRAINT [WorkspaceMember_role_check] CHECK ([role] IN (N'VIEWER', N'EDITOR', N'OWNER'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'WorkspaceInvite_role_check')
  ALTER TABLE [dbo].[WorkspaceInvite] WITH CHECK ADD CONSTRAINT [WorkspaceInvite_role_check] CHECK ([role] IN (N'VIEWER', N'EDITOR'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'WorkspaceInvite_status_check')
  ALTER TABLE [dbo].[WorkspaceInvite] WITH CHECK ADD CONSTRAINT [WorkspaceInvite_status_check] CHECK ([status] IN (N'PENDING', N'ACCEPTED', N'DECLINED', N'REVOKED'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'FinancialAccount_kind_check')
  ALTER TABLE [dbo].[FinancialAccount] WITH CHECK ADD CONSTRAINT [FinancialAccount_kind_check] CHECK ([kind] IN (N'BANK', N'CASH', N'VIRTUAL_BUDGET'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'Transaction_kind_check')
  ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_kind_check] CHECK ([kind] IN (N'EXPENSE', N'INCOME', N'TRANSFER', N'CREDIT_CARD_PAYMENT', N'RECEIVABLE_PAYMENT', N'ADJUSTMENT', N'REVERSAL', N'MIGRATION'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'Transaction_direction_check')
  ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_direction_check] CHECK ([direction] IN (N'DEBIT', N'CREDIT'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'Month_month_check')
  ALTER TABLE [dbo].[Month] WITH CHECK ADD CONSTRAINT [Month_month_check] CHECK ([month] BETWEEN 1 AND 12);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'MonthlyBudgetSource_month_check')
  ALTER TABLE [dbo].[MonthlyBudgetSource] WITH CHECK ADD CONSTRAINT [MonthlyBudgetSource_month_check] CHECK ([month] BETWEEN 1 AND 12);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'MonthlyBudget_month_check')
  ALTER TABLE [dbo].[MonthlyBudget] WITH CHECK ADD CONSTRAINT [MonthlyBudget_month_check] CHECK ([month] BETWEEN 1 AND 12);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'MonthlyBudgetPlan_month_check')
  ALTER TABLE [dbo].[MonthlyBudgetPlan] WITH CHECK ADD CONSTRAINT [MonthlyBudgetPlan_month_check] CHECK ([month] BETWEEN 1 AND 12);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'MonthlyBudgetPlan_status_check')
  ALTER TABLE [dbo].[MonthlyBudgetPlan] WITH CHECK ADD CONSTRAINT [MonthlyBudgetPlan_status_check] CHECK ([status] IN (N'DRAFT', N'REVIEW', N'CONFIRMED'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'AskNestMemory_kind_check')
  ALTER TABLE [dbo].[AskNestMemory] WITH CHECK ADD CONSTRAINT [AskNestMemory_kind_check] CHECK ([kind] IN (N'PREFERENCE', N'TERMINOLOGY', N'INSTRUCTION'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'AskNestMemory_status_check')
  ALTER TABLE [dbo].[AskNestMemory] WITH CHECK ADD CONSTRAINT [AskNestMemory_status_check] CHECK ([status] = N'ACTIVE');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'PostingGroup_status_check')
  ALTER TABLE [dbo].[PostingGroup] WITH CHECK ADD CONSTRAINT [PostingGroup_status_check] CHECK ([status] IN (N'POSTED', N'REVERSED'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'IdempotencyRecord_status_check')
  ALTER TABLE [dbo].[IdempotencyRecord] WITH CHECK ADD CONSTRAINT [IdempotencyRecord_status_check] CHECK ([status] IN (N'IN_PROGRESS', N'COMPLETED', N'FAILED'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'Receivable_status_check')
  ALTER TABLE [dbo].[Receivable] WITH CHECK ADD CONSTRAINT [Receivable_status_check] CHECK ([status] IN (N'OPEN', N'PARTIAL', N'PROCESSING', N'PAID', N'VOID'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'CardAlertStaging_source_check')
  ALTER TABLE [dbo].[CardAlertStaging] WITH CHECK ADD CONSTRAINT [CardAlertStaging_source_check] CHECK ([source] IN (N'EMAIL', N'GMAIL', N'API', N'MANUAL'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'CardAlertStaging_parseStatus_check')
  ALTER TABLE [dbo].[CardAlertStaging] WITH CHECK ADD CONSTRAINT [CardAlertStaging_parseStatus_check] CHECK ([parseStatus] IN (N'PENDING', N'PARSED', N'PROCESSING', N'PROCESSED', N'DUPLICATE', N'FAILED'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'BackgroundJob_status_check')
  ALTER TABLE [dbo].[BackgroundJob] WITH CHECK ADD CONSTRAINT [BackgroundJob_status_check] CHECK ([status] IN (N'PENDING', N'RUNNING', N'SUCCEEDED', N'SKIPPED', N'FAILED', N'DEAD_LETTER', N'CANCELLED'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'BackgroundJob_progress_check')
  EXEC(N'ALTER TABLE [dbo].[BackgroundJob] WITH CHECK ADD CONSTRAINT [BackgroundJob_progress_check] CHECK ([progress] BETWEEN 0 AND 100 AND [attempts] >= 0 AND [retryCount] >= 0 AND [maxAttempts] > 0 AND [duplicateCount] >= 0 AND ([total] IS NULL OR [total] >= 0) AND ([current] IS NULL OR [current] >= 0) AND ([total] IS NULL OR [current] IS NULL OR [current] <= [total]))');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'WebAuthnChallenge_purpose_check')
  ALTER TABLE [dbo].[WebAuthnChallenge] WITH CHECK ADD CONSTRAINT [WebAuthnChallenge_purpose_check] CHECK ([purpose] IN (N'REGISTRATION', N'AUTHENTICATION', N'LOGIN_TICKET'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'Workspace_baseCurrency_check')
  ALTER TABLE [dbo].[Workspace] WITH CHECK ADD CONSTRAINT [Workspace_baseCurrency_check] CHECK (LEN([baseCurrency]) = 3 AND [baseCurrency] COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z]%');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'CardAlertStaging_currency_check')
  ALTER TABLE [dbo].[CardAlertStaging] WITH CHECK ADD CONSTRAINT [CardAlertStaging_currency_check] CHECK ([currency] IS NULL OR (LEN([currency]) = 3 AND [currency] COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z]%'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'CreditCardAccount_calendar_check')
  ALTER TABLE [dbo].[CreditCardAccount] WITH CHECK ADD CONSTRAINT [CreditCardAccount_calendar_check] CHECK ([statementDay] BETWEEN 1 AND 31 AND [paymentDueDay] BETWEEN 1 AND 31 AND ([expiryMonth] IS NULL OR [expiryMonth] BETWEEN 1 AND 12) AND ([expiryYear] IS NULL OR [expiryYear] BETWEEN 2000 AND 9999));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'CreditCardTransaction_calendar_check')
  ALTER TABLE [dbo].[CreditCardTransaction] WITH CHECK ADD CONSTRAINT [CreditCardTransaction_calendar_check] CHECK ([statementMonth] BETWEEN 1 AND 12 AND [statementYear] BETWEEN 1900 AND 9999 AND ([isInstallment] = 0 OR ([installmentNo] >= 1 AND [totalInstallments] >= [installmentNo])));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'PointConversion_positive_check')
  ALTER TABLE [dbo].[PointConversion] WITH CHECK ADD CONSTRAINT [PointConversion_positive_check] CHECK ([fromPoints] > 0 AND [toMiles] > 0 AND [conversionRate] >= 0);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'HotelRewardAccount_value_check')
  ALTER TABLE [dbo].[HotelRewardAccount] WITH CHECK ADD CONSTRAINT [HotelRewardAccount_value_check] CHECK ([currentPoints] >= 0 AND ([targetPoints] IS NULL OR [targetPoints] > 0) AND [centsPerPoint] >= 0);

-- Filtered unique indexes preserve normal SQL Server NULL semantics.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[Workspace]') AND [name] = N'Workspace_publicNetWorthToken_key')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [Workspace_publicNetWorthToken_key] ON [dbo].[Workspace]([publicNetWorthToken]) WHERE [publicNetWorthToken] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[WorkspaceInvite]') AND [name] = N'WorkspaceInvite_tokenHash_unique')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [WorkspaceInvite_tokenHash_unique] ON [dbo].[WorkspaceInvite]([tokenHash]) WHERE [tokenHash] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_activeScopeKey_key')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [BackgroundJob_activeScopeKey_key] ON [dbo].[BackgroundJob]([activeScopeKey]) WHERE [activeScopeKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_idempotencyKey_key')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [BackgroundJob_idempotencyKey_key] ON [dbo].[BackgroundJob]([idempotencyKey]) WHERE [idempotencyKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_sourceMessageKey_key')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [CardAlertStaging_sourceMessageKey_key] ON [dbo].[CardAlertStaging]([sourceMessageKey]) WHERE [sourceMessageKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_transactionKey_key')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [CardAlertStaging_transactionKey_key] ON [dbo].[CardAlertStaging]([transactionKey]) WHERE [transactionKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CreditCardTxnLink]') AND [name] = N'CreditCardTxnLink_creditCardTransactionId_unique')
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [CreditCardTxnLink_creditCardTransactionId_unique] ON [dbo].[CreditCardTxnLink]([creditCardTransactionId]) WHERE [creditCardTransactionId] IS NOT NULL');

-- externalRef identifies a posting operation, not a row. Balanced postings such
-- as transfers intentionally share it across their debit and credit entries.

-- Composite candidate keys support workspace-consistent foreign keys.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[FinancialAccount]') AND [name] = N'FinancialAccount_workspaceId_id_key') CREATE UNIQUE INDEX [FinancialAccount_workspaceId_id_key] ON [dbo].[FinancialAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BudgetEnvelope]') AND [name] = N'BudgetEnvelope_workspaceId_id_key') CREATE UNIQUE INDEX [BudgetEnvelope_workspaceId_id_key] ON [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[TransactionGroup]') AND [name] = N'TransactionGroup_workspaceId_id_key') CREATE UNIQUE INDEX [TransactionGroup_workspaceId_id_key] ON [dbo].[TransactionGroup]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CreditCardAccount]') AND [name] = N'CreditCardAccount_workspaceId_id_key') CREATE UNIQUE INDEX [CreditCardAccount_workspaceId_id_key] ON [dbo].[CreditCardAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CreditCardTransaction]') AND [name] = N'CreditCardTransaction_workspaceId_id_key') CREATE UNIQUE INDEX [CreditCardTransaction_workspaceId_id_key] ON [dbo].[CreditCardTransaction]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[Receivable]') AND [name] = N'Receivable_workspaceId_id_key') CREATE UNIQUE INDEX [Receivable_workspaceId_id_key] ON [dbo].[Receivable]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[Month]') AND [name] = N'Month_workspaceId_id_key') CREATE UNIQUE INDEX [Month_workspaceId_id_key] ON [dbo].[Month]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CreditCardReward]') AND [name] = N'CreditCardReward_workspaceId_id_key') CREATE UNIQUE INDEX [CreditCardReward_workspaceId_id_key] ON [dbo].[CreditCardReward]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[FrequentFlyerAccount]') AND [name] = N'FrequentFlyerAccount_workspaceId_id_key') CREATE UNIQUE INDEX [FrequentFlyerAccount_workspaceId_id_key] ON [dbo].[FrequentFlyerAccount]([workspaceId], [id]);

-- Legacy receivables duplicated a cross-workspace source into the local relation
-- columns. Preserve the explicit source and clear only the invalid local aliases.
UPDATE r
SET
  [sourceWorkspaceId] = COALESCE(r.[sourceWorkspaceId], a.[workspaceId]),
  [sourceAccountId] = COALESCE(r.[sourceAccountId], r.[accountId]),
  [sourceBudgetId] = COALESCE(r.[sourceBudgetId], r.[budgetId]),
  [accountId] = NULL,
  [budgetId] = NULL
FROM [dbo].[Receivable] r
INNER JOIN [dbo].[FinancialAccount] a ON a.[id] = r.[accountId]
WHERE a.[workspaceId] <> r.[workspaceId];

-- Historical alert rows can outlive their parsed credit-card transaction. The
-- nullable relation is SetNull in the application model, so clear only dangling
-- identifiers while retaining the complete staging/audit row.
UPDATE s
SET [creditTransactionId] = NULL
FROM [dbo].[CardAlertStaging] s
LEFT JOIN [dbo].[CreditCardTransaction] t ON t.[id] = s.[creditTransactionId]
WHERE s.[creditTransactionId] IS NOT NULL AND t.[id] IS NULL;

-- No-action foreign keys avoid SQL Server multiple-cascade-path failures. Prisma remains
-- responsible for ordered cascades; SQL Server rejects orphan and cross-workspace writes.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'BudgetEnvelope_workspace_account_fkey') ALTER TABLE [dbo].[BudgetEnvelope] WITH CHECK ADD CONSTRAINT [BudgetEnvelope_workspace_account_fkey] FOREIGN KEY ([workspaceId], [accountId]) REFERENCES [dbo].[FinancialAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'BudgetItem_workspace_destination_fkey') ALTER TABLE [dbo].[BudgetItem] WITH CHECK ADD CONSTRAINT [BudgetItem_workspace_destination_fkey] FOREIGN KEY ([workspaceId], [destinationSubAccountId]) REFERENCES [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Transaction_workspace_account_fkey') ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_workspace_account_fkey] FOREIGN KEY ([workspaceId], [accountId]) REFERENCES [dbo].[FinancialAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Transaction_workspace_budget_fkey') ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_workspace_budget_fkey] FOREIGN KEY ([workspaceId], [budgetId]) REFERENCES [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Transaction_workspace_group_fkey') ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_workspace_group_fkey] FOREIGN KEY ([workspaceId], [groupId]) REFERENCES [dbo].[TransactionGroup]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Transaction_workspace_credit_card_transaction_fkey') ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_workspace_credit_card_transaction_fkey] FOREIGN KEY ([workspaceId], [creditCardTransactionId]) REFERENCES [dbo].[CreditCardTransaction]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Transaction_workspace_receivable_fkey') ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_workspace_receivable_fkey] FOREIGN KEY ([workspaceId], [receivableId]) REFERENCES [dbo].[Receivable]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Transaction_workspace_posting_group_fkey') ALTER TABLE [dbo].[Transaction] WITH CHECK ADD CONSTRAINT [Transaction_workspace_posting_group_fkey] FOREIGN KEY ([postingGroupId]) REFERENCES [dbo].[PostingGroup]([id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'TransactionGroup_workspace_budget_fkey') ALTER TABLE [dbo].[TransactionGroup] WITH CHECK ADD CONSTRAINT [TransactionGroup_workspace_budget_fkey] FOREIGN KEY ([workspaceId], [budgetId]) REFERENCES [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'CreditCardReward_workspace_credit_card_fkey') ALTER TABLE [dbo].[CreditCardReward] WITH CHECK ADD CONSTRAINT [CreditCardReward_workspace_credit_card_fkey] FOREIGN KEY ([workspaceId], [creditCardId]) REFERENCES [dbo].[CreditCardAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'PointConversion_workspace_reward_fkey') ALTER TABLE [dbo].[PointConversion] WITH CHECK ADD CONSTRAINT [PointConversion_workspace_reward_fkey] FOREIGN KEY ([workspaceId], [creditCardRewardId]) REFERENCES [dbo].[CreditCardReward]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'PointConversion_workspace_flyer_fkey') ALTER TABLE [dbo].[PointConversion] WITH CHECK ADD CONSTRAINT [PointConversion_workspace_flyer_fkey] FOREIGN KEY ([workspaceId], [frequentFlyerId]) REFERENCES [dbo].[FrequentFlyerAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'CreditCardTransaction_workspace_card_fkey') ALTER TABLE [dbo].[CreditCardTransaction] WITH CHECK ADD CONSTRAINT [CreditCardTransaction_workspace_card_fkey] FOREIGN KEY ([workspaceId], [creditCardId]) REFERENCES [dbo].[CreditCardAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'CreditCardTransaction_workspace_budget_fkey') ALTER TABLE [dbo].[CreditCardTransaction] WITH CHECK ADD CONSTRAINT [CreditCardTransaction_workspace_budget_fkey] FOREIGN KEY ([workspaceId], [budgetId]) REFERENCES [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'CardAlertStaging_workspace_card_fkey') ALTER TABLE [dbo].[CardAlertStaging] WITH CHECK ADD CONSTRAINT [CardAlertStaging_workspace_card_fkey] FOREIGN KEY ([workspaceId], [creditCardId]) REFERENCES [dbo].[CreditCardAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'CardAlertStaging_workspace_transaction_fkey') ALTER TABLE [dbo].[CardAlertStaging] WITH CHECK ADD CONSTRAINT [CardAlertStaging_workspace_transaction_fkey] FOREIGN KEY ([workspaceId], [creditTransactionId]) REFERENCES [dbo].[CreditCardTransaction]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Receivable_workspace_account_fkey') ALTER TABLE [dbo].[Receivable] WITH CHECK ADD CONSTRAINT [Receivable_workspace_account_fkey] FOREIGN KEY ([workspaceId], [accountId]) REFERENCES [dbo].[FinancialAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Receivable_workspace_budget_fkey') ALTER TABLE [dbo].[Receivable] WITH CHECK ADD CONSTRAINT [Receivable_workspace_budget_fkey] FOREIGN KEY ([workspaceId], [budgetId]) REFERENCES [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Receivable_workspace_month_fkey') ALTER TABLE [dbo].[Receivable] WITH CHECK ADD CONSTRAINT [Receivable_workspace_month_fkey] FOREIGN KEY ([workspaceId], [statementMonthId]) REFERENCES [dbo].[Month]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Receivable_workspace_posting_group_fkey') ALTER TABLE [dbo].[Receivable] WITH CHECK ADD CONSTRAINT [Receivable_workspace_posting_group_fkey] FOREIGN KEY ([postingGroupId]) REFERENCES [dbo].[PostingGroup]([id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Workspace_default_account_fkey') ALTER TABLE [dbo].[Workspace] WITH CHECK ADD CONSTRAINT [Workspace_default_account_fkey] FOREIGN KEY ([id], [receivableDefaultAccountId]) REFERENCES [dbo].[FinancialAccount]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'Workspace_default_budget_fkey') ALTER TABLE [dbo].[Workspace] WITH CHECK ADD CONSTRAINT [Workspace_default_budget_fkey] FOREIGN KEY ([id], [receivableDefaultBudgetId]) REFERENCES [dbo].[BudgetEnvelope]([workspaceId], [id]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'GmailIntegration_workspace_member_fkey') ALTER TABLE [dbo].[GmailIntegration] WITH CHECK ADD CONSTRAINT [GmailIntegration_workspace_member_fkey] FOREIGN KEY ([workspaceId], [userId]) REFERENCES [dbo].[WorkspaceMember]([workspaceId], [userId]);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'IntegrationOAuthState_workspace_member_fkey') ALTER TABLE [dbo].[IntegrationOAuthState] WITH CHECK ADD CONSTRAINT [IntegrationOAuthState_workspace_member_fkey] FOREIGN KEY ([workspaceId], [userId]) REFERENCES [dbo].[WorkspaceMember]([workspaceId], [userId]);

-- PostingGroup uses bounded Phase 1 workspace IDs while older ledger tables use
-- NVARCHAR(1000). SQL Server requires identical lengths for a composite FK, so
-- triggers enforce the workspace half and the single-column FKs above enforce
-- existence and deletion safety.
EXEC(N'CREATE OR ALTER TRIGGER [dbo].[Transaction_posting_group_workspace_trg]
ON [dbo].[Transaction] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted i INNER JOIN [dbo].[PostingGroup] p ON p.[id] = i.[postingGroupId] WHERE i.[postingGroupId] IS NOT NULL AND i.[workspaceId] <> p.[workspaceId])
    THROW 51000, ''Transaction posting group must belong to the same workspace.'', 1;
END');
EXEC(N'CREATE OR ALTER TRIGGER [dbo].[Receivable_posting_group_workspace_trg]
ON [dbo].[Receivable] AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted i INNER JOIN [dbo].[PostingGroup] p ON p.[id] = i.[postingGroupId] WHERE i.[postingGroupId] IS NOT NULL AND i.[workspaceId] <> p.[workspaceId])
    THROW 51000, ''Receivable posting group must belong to the same workspace.'', 1;
END');
EXEC(N'CREATE OR ALTER TRIGGER [dbo].[PostingGroup_workspace_update_trg]
ON [dbo].[PostingGroup] AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE([workspaceId]) AND EXISTS (
    SELECT 1 FROM inserted i INNER JOIN [dbo].[Transaction] t ON t.[postingGroupId] = i.[id] WHERE t.[workspaceId] <> i.[workspaceId]
    UNION ALL
    SELECT 1 FROM inserted i INNER JOIN [dbo].[Receivable] r ON r.[postingGroupId] = i.[id] WHERE r.[workspaceId] <> i.[workspaceId]
  )
    THROW 51000, ''Posting group workspace cannot differ from linked records.'', 1;
END');

-- Initial purge. The bounded scheduler keeps these policies enforced after deployment.
DELETE FROM [dbo].[WebAuthnChallenge] WHERE [expiresAt] < SYSUTCDATETIME();
DELETE FROM [dbo].[IntegrationOAuthState] WHERE [expiresAt] < SYSUTCDATETIME();
UPDATE [dbo].[CardAlertStaging] SET [rawBody] = N'[REDACTED]', [rawSubject] = NULL WHERE [createdAt] < DATEADD(DAY, -7, SYSUTCDATETIME()) AND [rawBody] <> N'[REDACTED]';
EXEC(N'UPDATE [dbo].[BackgroundJob] SET [payloadJson] = NULL, [checkpointJson] = NULL, [resultJson] = NULL, [error] = NULL WHERE [finishedAt] < DATEADD(DAY, -14, SYSUTCDATETIME())');
DELETE FROM [dbo].[BackgroundJob] WHERE [status] IN (N'SUCCEEDED', N'SKIPPED', N'FAILED', N'DEAD_LETTER', N'CANCELLED') AND [finishedAt] < DATEADD(DAY, -90, SYSUTCDATETIME());
DELETE FROM [dbo].[WorkspaceInvite] WHERE ([expiresAt] < DATEADD(DAY, -30, SYSUTCDATETIME())) OR ([status] <> N'PENDING' AND [respondedAt] < DATEADD(DAY, -30, SYSUTCDATETIME()));
DELETE FROM [dbo].[InAppNotification] WHERE ([readAt] < DATEADD(DAY, -90, SYSUTCDATETIME())) OR ([createdAt] < DATEADD(DAY, -365, SYSUTCDATETIME()));
DELETE FROM [dbo].[WorkspaceAuditLog] WHERE [createdAt] < DATEADD(DAY, -730, SYSUTCDATETIME());

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
