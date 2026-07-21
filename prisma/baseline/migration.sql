BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000),
    [emailVerified] DATETIME2,
    [name] NVARCHAR(1000),
    [image] NVARCHAR(1000),
    [activeWorkspaceId] NVARCHAR(1000),
    [sessionVersion] INT NOT NULL CONSTRAINT [User_sessionVersion_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Account] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [provider] NVARCHAR(1000) NOT NULL,
    [providerAccountId] NVARCHAR(1000) NOT NULL,
    [refresh_token] NVARCHAR(max),
    [access_token] NVARCHAR(max),
    [expires_at] INT,
    [token_type] NVARCHAR(1000),
    [scope] NVARCHAR(1000),
    [id_token] NVARCHAR(max),
    [session_state] NVARCHAR(max),
    CONSTRAINT [Account_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Account_provider_providerAccountId_key] UNIQUE NONCLUSTERED ([provider],[providerAccountId])
);

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(1000) NOT NULL,
    [sessionToken] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [expires] DATETIME2 NOT NULL,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Session_sessionToken_key] UNIQUE NONCLUSTERED ([sessionToken])
);

-- CreateTable
CREATE TABLE [dbo].[VerificationToken] (
    [identifier] NVARCHAR(1000) NOT NULL,
    [token] NVARCHAR(1000) NOT NULL,
    [expires] DATETIME2 NOT NULL,
    CONSTRAINT [VerificationToken_token_key] UNIQUE NONCLUSTERED ([token]),
    CONSTRAINT [VerificationToken_identifier_token_key] UNIQUE NONCLUSTERED ([identifier],[token])
);

-- CreateTable
CREATE TABLE [dbo].[Workspace] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [baseCurrency] NVARCHAR(1000) NOT NULL CONSTRAINT [Workspace_baseCurrency_df] DEFAULT 'SGD',
    [receivableDefaultAccountId] NVARCHAR(1000),
    [receivableDefaultBudgetId] NVARCHAR(1000),
    [isShared] BIT NOT NULL CONSTRAINT [Workspace_isShared_df] DEFAULT 0,
    [sidebarMoneyPages] NVARCHAR(1000),
    [creditCardAutoRules] NVARCHAR(max),
    [publicNetWorthEnabled] BIT NOT NULL CONSTRAINT [Workspace_publicNetWorthEnabled_df] DEFAULT 0,
    [publicNetWorthToken] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Workspace_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Workspace_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WorkspaceInvite] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [invitedEmail] NVARCHAR(1000) NOT NULL,
    [invitedById] NVARCHAR(1000) NOT NULL,
    [invitedUserId] NVARCHAR(1000),
    [role] NVARCHAR(1000) NOT NULL CONSTRAINT [WorkspaceInvite_role_df] DEFAULT 'VIEWER',
    [tokenHash] VARCHAR(64),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [WorkspaceInvite_status_df] DEFAULT 'PENDING',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WorkspaceInvite_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2,
    [respondedAt] DATETIME2,
    [revokedAt] DATETIME2,
    CONSTRAINT [WorkspaceInvite_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WorkspaceAuditLog] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [actorUserId] NVARCHAR(1000),
    [action] NVARCHAR(1000) NOT NULL,
    [details] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WorkspaceAuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WorkspaceAuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InvestmentAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [displayName] NVARCHAR(1000),
    [institutionName] NVARCHAR(1000) NOT NULL,
    [productName] NVARCHAR(1000) NOT NULL,
    [inceptionDate] DATETIME2 NOT NULL,
    [divestedDate] DATETIME2,
    [isLiquid] BIT NOT NULL CONSTRAINT [InvestmentAccount_isLiquid_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InvestmentAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InvestmentAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [InvestmentAccount_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[InvestmentEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [investedCents] INT NOT NULL,
    [currentValueCents] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InvestmentEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InvestmentEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WorkspaceMember] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL CONSTRAINT [WorkspaceMember_role_df] DEFAULT 'VIEWER',
    [invitedBy] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WorkspaceMember_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WorkspaceMember_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [WorkspaceMember_workspaceId_userId_key] UNIQUE NONCLUSTERED ([workspaceId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[SecurityRateLimit] (
    [keyHash] VARCHAR(64) NOT NULL,
    [count] INT NOT NULL CONSTRAINT [SecurityRateLimit_count_df] DEFAULT 0,
    [windowStartedAt] DATETIME2 NOT NULL,
    [blockedUntil] DATETIME2,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SecurityRateLimit_pkey] PRIMARY KEY CLUSTERED ([keyHash])
);

-- CreateTable
CREATE TABLE [dbo].[IntegrationOAuthState] (
    [tokenHash] VARCHAR(64) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [pkceVerifier] NVARCHAR(max) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IntegrationOAuthState_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [IntegrationOAuthState_pkey] PRIMARY KEY CLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[Month] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [label] NVARCHAR(1000) NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [sortOrder] INT NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Month_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Month_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Month_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Month_workspaceId_year_month_key] UNIQUE NONCLUSTERED ([workspaceId],[year],[month]),
    CONSTRAINT [Month_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[AccountType] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [label] NVARCHAR(1000) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [AccountType_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [AccountType_isActive_df] DEFAULT 1,
    [color] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountType_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AccountType_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountType_workspaceId_label_key] UNIQUE NONCLUSTERED ([workspaceId],[label])
);

-- CreateTable
CREATE TABLE [dbo].[FinancialAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [accountTypeId] NVARCHAR(1000),
    [name] NVARCHAR(1000) NOT NULL,
    [bankName] NVARCHAR(1000),
    [kind] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [startingCents] INT NOT NULL CONSTRAINT [FinancialAccount_startingCents_df] DEFAULT 0,
    [isFromFamily] BIT NOT NULL CONSTRAINT [FinancialAccount_isFromFamily_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [FinancialAccount_isActive_df] DEFAULT 1,
    [isSynced] BIT NOT NULL CONSTRAINT [FinancialAccount_isSynced_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FinancialAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FinancialAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FinancialAccount_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[BudgetEnvelope] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [icon] NVARCHAR(1000),
    [targetCents] INT NOT NULL CONSTRAINT [BudgetEnvelope_targetCents_df] DEFAULT 0,
    [availableCents] INT NOT NULL CONSTRAINT [BudgetEnvelope_availableCents_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [BudgetEnvelope_isActive_df] DEFAULT 1,
    [createdById] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BudgetEnvelope_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BudgetEnvelope_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BudgetEnvelope_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[BudgetItem] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [amountCents] INT NOT NULL CONSTRAINT [BudgetItem_amountCents_df] DEFAULT 0,
    [isMonthly] BIT NOT NULL CONSTRAINT [BudgetItem_isMonthly_df] DEFAULT 1,
    [destinationSubAccountId] NVARCHAR(1000),
    [sortOrder] INT NOT NULL CONSTRAINT [BudgetItem_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [BudgetItem_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BudgetItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BudgetItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BudgetItem_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[BudgetSource] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [ownerId] NVARCHAR(1000) NOT NULL,
    [amountCents] INT NOT NULL CONSTRAINT [BudgetSource_amountCents_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [BudgetSource_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BudgetSource_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BudgetSource_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BudgetSource_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[MonthlyBudgetSource] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [budgetSourceId] NVARCHAR(1000) NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [ownerId] NVARCHAR(1000) NOT NULL,
    [amountCents] INT NOT NULL CONSTRAINT [MonthlyBudgetSource_amountCents_df] DEFAULT 0,
    [isDraft] BIT NOT NULL CONSTRAINT [MonthlyBudgetSource_isDraft_df] DEFAULT 1,
    [confirmedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetSource_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MonthlyBudgetSource_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MonthlyBudgetSource_workspaceId_year_month_budgetSourceId_key] UNIQUE NONCLUSTERED ([workspaceId],[year],[month],[budgetSourceId])
);

-- CreateTable
CREATE TABLE [dbo].[MonthlyBudget] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [budgetItemId] NVARCHAR(1000) NOT NULL,
    [budgetSourceId] NVARCHAR(1000) NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [budgetItemTitle] NVARCHAR(1000),
    [budgetSourceTitle] NVARCHAR(1000),
    [destinationSubAccountId] NVARCHAR(1000),
    [allocatedCents] INT NOT NULL CONSTRAINT [MonthlyBudget_allocatedCents_df] DEFAULT 0,
    [isDraft] BIT NOT NULL CONSTRAINT [MonthlyBudget_isDraft_df] DEFAULT 1,
    [confirmedAt] DATETIME2,
    [appliedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudget_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MonthlyBudget_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MonthlyBudget_workspaceId_year_month_budgetItemId_budgetSourceId_key] UNIQUE NONCLUSTERED ([workspaceId],[year],[month],[budgetItemId],[budgetSourceId])
);

-- CreateTable
CREATE TABLE [dbo].[MonthlyBudgetPlan] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [MonthlyBudgetPlan_status_df] DEFAULT 'DRAFT',
    [confirmedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetPlan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MonthlyBudgetPlan_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MonthlyBudgetPlan_workspaceId_year_month_key] UNIQUE NONCLUSTERED ([workspaceId],[year],[month])
);

-- CreateTable
CREATE TABLE [dbo].[MonthlyBudgetPlanSource] (
    [id] NVARCHAR(1000) NOT NULL,
    [planId] NVARCHAR(1000) NOT NULL,
    [templateSourceId] NVARCHAR(1000),
    [title] NVARCHAR(1000) NOT NULL,
    [ownerId] NVARCHAR(1000) NOT NULL,
    [amountCents] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanSource_amountCents_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanSource_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetPlanSource_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MonthlyBudgetPlanSource_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MonthlyBudgetPlanItem] (
    [id] NVARCHAR(1000) NOT NULL,
    [planId] NVARCHAR(1000) NOT NULL,
    [templateItemId] NVARCHAR(1000),
    [title] NVARCHAR(1000) NOT NULL,
    [amountCents] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_amountCents_df] DEFAULT 0,
    [destinationSubAccountId] NVARCHAR(1000),
    [sortOrder] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_sortOrder_df] DEFAULT 0,
    [appliedCents] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_appliedCents_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MonthlyBudgetPlanItem_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseType] (
    [id] NVARCHAR(1000) NOT NULL,
    [budgetId] NVARCHAR(1000) NOT NULL,
    [label] NVARCHAR(1000) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [ExpenseType_sortOrder_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [ExpenseType_isActive_df] DEFAULT 1,
    CONSTRAINT [ExpenseType_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ExpenseType_budgetId_label_key] UNIQUE NONCLUSTERED ([budgetId],[label])
);

-- CreateTable
CREATE TABLE [dbo].[Transaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [budgetId] NVARCHAR(1000),
    [groupId] NVARCHAR(1000),
    [kind] NVARCHAR(1000) NOT NULL,
    [direction] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [amountCents] INT NOT NULL,
    [subject] NVARCHAR(1000) NOT NULL,
    [details] NVARCHAR(1000),
    [notes] NVARCHAR(max),
    [isSynced] BIT NOT NULL CONSTRAINT [Transaction_isSynced_df] DEFAULT 0,
    [isFromFamily] BIT NOT NULL CONSTRAINT [Transaction_isFromFamily_df] DEFAULT 0,
    [externalRef] NVARCHAR(1000),
    [postingGroupId] NVARCHAR(191),
    [creditCardTransactionId] NVARCHAR(1000),
    [receivableId] NVARCHAR(1000),
    [reversalOfId] NVARCHAR(1000),
    [voidedAt] DATETIME2,
    [voidedByUserId] NVARCHAR(191),
    [voidReason] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Transaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Transaction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Transaction_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[AskNestTurn] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [question] NVARCHAR(max) NOT NULL,
    [answerJson] NVARCHAR(max) NOT NULL,
    [pagePath] NVARCHAR(1000) NOT NULL,
    [inputTokens] INT,
    [outputTokens] INT,
    [totalTokens] INT,
    [diagnosticsJson] NVARCHAR(max),
    [toolCallCount] INT NOT NULL CONSTRAINT [AskNestTurn_toolCallCount_df] DEFAULT 0,
    [emptyResultCount] INT NOT NULL CONSTRAINT [AskNestTurn_emptyResultCount_df] DEFAULT 0,
    [durationMs] INT,
    [feedbackRating] NVARCHAR(1000),
    [feedbackReason] NVARCHAR(1000),
    [feedbackAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AskNestTurn_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AskNestTurn_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AskNestMemory] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [ownerHash] VARCHAR(64) NOT NULL,
    [keyHash] VARCHAR(64) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000) NOT NULL,
    [content] NVARCHAR(1000) NOT NULL,
    [sourceTurnId] NVARCHAR(1000),
    [confidence] FLOAT(53) NOT NULL CONSTRAINT [AskNestMemory_confidence_df] DEFAULT 1,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [AskNestMemory_status_df] DEFAULT 'ACTIVE',
    [lastConfirmedAt] DATETIME2,
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AskNestMemory_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AskNestMemory_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AskNestMemory_ownerHash_keyHash_key] UNIQUE NONCLUSTERED ([ownerHash],[keyHash])
);

-- CreateTable
CREATE TABLE [dbo].[AskNestUsageDaily] (
    [id] NVARCHAR(1000) NOT NULL,
    [day] VARCHAR(10) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [turnCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_turnCount_df] DEFAULT 0,
    [trackedTurnCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_trackedTurnCount_df] DEFAULT 0,
    [inputTokens] INT NOT NULL CONSTRAINT [AskNestUsageDaily_inputTokens_df] DEFAULT 0,
    [outputTokens] INT NOT NULL CONSTRAINT [AskNestUsageDaily_outputTokens_df] DEFAULT 0,
    [totalTokens] INT NOT NULL CONSTRAINT [AskNestUsageDaily_totalTokens_df] DEFAULT 0,
    [toolCallCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_toolCallCount_df] DEFAULT 0,
    [emptyResultCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_emptyResultCount_df] DEFAULT 0,
    [totalDurationMs] INT NOT NULL CONSTRAINT [AskNestUsageDaily_totalDurationMs_df] DEFAULT 0,
    [feedbackCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_feedbackCount_df] DEFAULT 0,
    [helpfulCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_helpfulCount_df] DEFAULT 0,
    [notHelpfulCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_notHelpfulCount_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AskNestUsageDaily_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AskNestUsageDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AskNestUsageDaily_day_workspaceId_userId_key] UNIQUE NONCLUSTERED ([day],[workspaceId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[PostingGroup] (
    [id] NVARCHAR(191) NOT NULL,
    [workspaceId] NVARCHAR(191) NOT NULL,
    [operation] NVARCHAR(120) NOT NULL,
    [sourceType] NVARCHAR(80),
    [sourceId] NVARCHAR(191),
    [actorUserId] NVARCHAR(191),
    [idempotencyKey] NVARCHAR(191) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [PostingGroup_status_df] DEFAULT 'POSTED',
    [reversalOfId] NVARCHAR(191),
    [reason] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PostingGroup_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [reversedAt] DATETIME2,
    CONSTRAINT [PostingGroup_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PostingGroup_workspaceId_operation_idempotencyKey_key] UNIQUE NONCLUSTERED ([workspaceId],[operation],[idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[IdempotencyRecord] (
    [id] NVARCHAR(191) NOT NULL,
    [workspaceId] NVARCHAR(191) NOT NULL,
    [operation] NVARCHAR(120) NOT NULL,
    [idempotencyKey] NVARCHAR(191) NOT NULL,
    [requestHash] NVARCHAR(64) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [IdempotencyRecord_status_df] DEFAULT 'IN_PROGRESS',
    [postingGroupId] NVARCHAR(191),
    [resultJson] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IdempotencyRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    CONSTRAINT [IdempotencyRecord_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IdempotencyRecord_workspaceId_operation_idempotencyKey_key] UNIQUE NONCLUSTERED ([workspaceId],[operation],[idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[TransactionGroup] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [budgetId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [icon] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TransactionGroup_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TransactionGroup_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TransactionGroup_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[Expense] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [expenseTypeId] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Expense_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Expense_transactionId_key] UNIQUE NONCLUSTERED ([transactionId])
);

-- CreateTable
CREATE TABLE [dbo].[CreditCardAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [cardName] NVARCHAR(1000) NOT NULL,
    [bankName] NVARCHAR(1000),
    [themeKey] NVARCHAR(1000),
    [last4Digit] NVARCHAR(1000) NOT NULL,
    [expiryMonth] INT,
    [expiryYear] INT,
    [statementDay] INT NOT NULL,
    [paymentDueDay] INT NOT NULL,
    [bonusLimitCents] INT,
    [bonusStatementCents] INT,
    [notes] NVARCHAR(1000),
    [isFullySynced] BIT NOT NULL CONSTRAINT [CreditCardAccount_isFullySynced_df] DEFAULT 0,
    [fullySyncedDate] DATETIME2,
    [isActive] BIT NOT NULL CONSTRAINT [CreditCardAccount_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CreditCardAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CreditCardAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CreditCardAccount_workspaceId_cardName_key] UNIQUE NONCLUSTERED ([workspaceId],[cardName]),
    CONSTRAINT [CreditCardAccount_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[CreditCardTxnLink] (
    [id] NVARCHAR(1000) NOT NULL,
    [creditCardId] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [creditCardTransactionId] NVARCHAR(1000),
    [cardNameSnapshot] NVARCHAR(1000),
    [cardNoEnding] NVARCHAR(1000),
    [txDate] DATETIME2 NOT NULL,
    [isProcessed] BIT NOT NULL CONSTRAINT [CreditCardTxnLink_isProcessed_df] DEFAULT 0,
    [interfacedAt] DATETIME2,
    CONSTRAINT [CreditCardTxnLink_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CreditCardTxnLink_creditCardId_transactionId_key] UNIQUE NONCLUSTERED ([creditCardId],[transactionId])
);

-- CreateTable
CREATE TABLE [dbo].[Receivable] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000),
    [budgetId] NVARCHAR(1000),
    [statementMonthId] NVARCHAR(1000),
    [title] NVARCHAR(1000) NOT NULL,
    [amountCents] INT NOT NULL,
    [date] DATETIME2 NOT NULL,
    [transactionDate] DATETIME2,
    [isMom] BIT NOT NULL CONSTRAINT [Receivable_isMom_df] DEFAULT 0,
    [isFamily] BIT NOT NULL CONSTRAINT [Receivable_isFamily_df] DEFAULT 0,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Receivable_status_df] DEFAULT 'OPEN',
    [remarkTogether] NVARCHAR(1000),
    [notes] NVARCHAR(max),
    [fromUserId] NVARCHAR(1000),
    [toUserId] NVARCHAR(1000),
    [sourceWorkspaceId] NVARCHAR(1000),
    [sourceAccountId] NVARCHAR(1000),
    [sourceBudgetId] NVARCHAR(1000),
    [postingGroupId] NVARCHAR(191),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Receivable_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Receivable_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Receivable_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[SalaryEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [amountCents] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SalaryEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SalaryEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsdAccountEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [amountCents] INT NOT NULL,
    [isHide] BIT NOT NULL CONSTRAINT [UsdAccountEntry_isHide_df] DEFAULT 0,
    [description] NVARCHAR(1000),
    [exchangeRate] DECIMAL(10,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UsdAccountEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UsdAccountEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsdInvestmentEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [amountCents] INT NOT NULL,
    [principalCents] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UsdInvestmentEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UsdInvestmentEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[NoteList] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [subject] NVARCHAR(1000),
    [amountCents] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NoteList_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [NoteList_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Note] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [noteListId] NVARCHAR(1000),
    [createdById] NVARCHAR(1000),
    [title] NVARCHAR(1000) NOT NULL,
    [content] NVARCHAR(1000) NOT NULL,
    [isDeleted] BIT NOT NULL CONSTRAINT [Note_isDeleted_df] DEFAULT 0,
    [isList] BIT NOT NULL CONSTRAINT [Note_isList_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Note_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [modifiedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Note_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MileProgram] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [frequentFlyerId] NVARCHAR(1000),
    [date] DATETIME2 NOT NULL,
    [miles] INT NOT NULL,
    [balanceMiles] INT NOT NULL,
    [expiryDate] DATETIME2,
    [title] NVARCHAR(1000),
    [firstRedeemedDate] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MileProgram_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MileProgram_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MileRedemption] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [frequentFlyerId] NVARCHAR(1000),
    [redemptionTitle] NVARCHAR(1000) NOT NULL,
    [totalMilesRedeemed] INT NOT NULL,
    [dateTime] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MileRedemption_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MileRedemption_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MileRedemptionDetail] (
    [id] NVARCHAR(1000) NOT NULL,
    [redemptionId] NVARCHAR(1000) NOT NULL,
    [milesFileId] NVARCHAR(1000) NOT NULL,
    [milesRedeemed] INT NOT NULL,
    CONSTRAINT [MileRedemptionDetail_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[LegacyRecordLink] (
    [id] NVARCHAR(1000) NOT NULL,
    [system] NVARCHAR(1000) NOT NULL CONSTRAINT [LegacyRecordLink_system_df] DEFAULT 'LEGACY_NEST_V1',
    [sourceTable] NVARCHAR(1000) NOT NULL,
    [sourceId] NVARCHAR(1000) NOT NULL,
    [targetModel] NVARCHAR(1000) NOT NULL,
    [targetId] NVARCHAR(1000) NOT NULL,
    [migratedAt] DATETIME2 NOT NULL CONSTRAINT [LegacyRecordLink_migratedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [checksum] NVARCHAR(1000),
    [transactionId] NVARCHAR(1000),
    CONSTRAINT [LegacyRecordLink_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LegacyRecordLink_transactionId_key] UNIQUE NONCLUSTERED ([transactionId]),
    CONSTRAINT [LegacyRecordLink_system_sourceTable_sourceId_key] UNIQUE NONCLUSTERED ([system],[sourceTable],[sourceId])
);

-- CreateTable
CREATE TABLE [dbo].[FrequentFlyerAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [programName] NVARCHAR(1000) NOT NULL,
    [airlineName] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000),
    [currentMiles] INT NOT NULL CONSTRAINT [FrequentFlyerAccount_currentMiles_df] DEFAULT 0,
    [targetMiles] INT,
    [expiryWarning] INT CONSTRAINT [FrequentFlyerAccount_expiryWarning_df] DEFAULT 6,
    [mileNeverExpire] BIT NOT NULL CONSTRAINT [FrequentFlyerAccount_mileNeverExpire_df] DEFAULT 0,
    [validityPeriodYears] INT NOT NULL CONSTRAINT [FrequentFlyerAccount_validityPeriodYears_df] DEFAULT 3,
    [notes] NVARCHAR(1000),
    [isActive] BIT NOT NULL CONSTRAINT [FrequentFlyerAccount_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FrequentFlyerAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FrequentFlyerAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FrequentFlyerAccount_workspaceId_programName_key] UNIQUE NONCLUSTERED ([workspaceId],[programName]),
    CONSTRAINT [FrequentFlyerAccount_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[HotelRewardAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [programName] NVARCHAR(1000) NOT NULL,
    [hotelBrand] NVARCHAR(1000) NOT NULL,
    [accountNumber] NVARCHAR(1000),
    [currentPoints] INT NOT NULL CONSTRAINT [HotelRewardAccount_currentPoints_df] DEFAULT 0,
    [targetPoints] INT,
    [centsPerPoint] DECIMAL(19,8) NOT NULL CONSTRAINT [HotelRewardAccount_centsPerPoint_df] DEFAULT 0,
    [notes] NVARCHAR(1000),
    [isActive] BIT NOT NULL CONSTRAINT [HotelRewardAccount_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HotelRewardAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [HotelRewardAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HotelRewardAccount_workspaceId_programName_key] UNIQUE NONCLUSTERED ([workspaceId],[programName]),
    CONSTRAINT [HotelRewardAccount_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[CreditCardReward] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [creditCardId] NVARCHAR(1000) NOT NULL,
    [currentPoints] INT NOT NULL CONSTRAINT [CreditCardReward_currentPoints_df] DEFAULT 0,
    [pointsValueCents] INT,
    [lastUpdated] DATETIME2 NOT NULL CONSTRAINT [CreditCardReward_lastUpdated_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CreditCardReward_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CreditCardReward_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CreditCardReward_creditCardId_key] UNIQUE NONCLUSTERED ([creditCardId]),
    CONSTRAINT [CreditCardReward_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[PointConversion] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [creditCardRewardId] NVARCHAR(1000),
    [frequentFlyerId] NVARCHAR(1000),
    [fromPoints] INT NOT NULL,
    [toMiles] INT NOT NULL,
    [conversionRate] DECIMAL(19,8) NOT NULL,
    [description] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PointConversion_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PointConversion_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PointConversion_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[CreditCardTransaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [creditCardId] NVARCHAR(1000) NOT NULL,
    [transactionDate] DATETIME2 NOT NULL,
    [paymentDueDate] DATETIME2,
    [statementMonth] INT NOT NULL,
    [statementYear] INT NOT NULL,
    [amountCents] INT NOT NULL,
    [subject] NVARCHAR(1000) NOT NULL,
    [isInstallment] BIT NOT NULL CONSTRAINT [CreditCardTransaction_isInstallment_df] DEFAULT 0,
    [installmentNo] INT,
    [totalInstallments] INT,
    [isAllocated] BIT NOT NULL CONSTRAINT [CreditCardTransaction_isAllocated_df] DEFAULT 0,
    [budgetId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CreditCardTransaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CreditCardTransaction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CreditCardTransaction_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[CardAlertStaging] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [CardAlertStaging_source_df] DEFAULT 'EMAIL',
    [bankName] NVARCHAR(1000),
    [transactionRef] NVARCHAR(1000),
    [rawSubject] NVARCHAR(1000),
    [rawBody] NVARCHAR(max) NOT NULL,
    [sourceMessageKey] VARCHAR(64),
    [transactionKey] VARCHAR(64),
    [contentHash] VARCHAR(64),
    [currency] NVARCHAR(1000),
    [amountCents] INT,
    [transactionDate] DATETIME2,
    [merchant] NVARCHAR(1000),
    [cardLast4] NVARCHAR(1000),
    [parseStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [CardAlertStaging_parseStatus_df] DEFAULT 'PENDING',
    [processingStartedAt] DATETIME2,
    [failureReason] NVARCHAR(1000),
    [creditCardId] NVARCHAR(1000),
    [creditTransactionId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CardAlertStaging_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [processedAt] DATETIME2,
    CONSTRAINT [CardAlertStaging_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[GmailIntegration] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [accessToken] NVARCHAR(max),
    [refreshToken] NVARCHAR(max),
    [tokenType] NVARCHAR(1000),
    [scope] NVARCHAR(max),
    [expiryDate] DATETIME2,
    [isActive] BIT NOT NULL CONSTRAINT [GmailIntegration_isActive_df] DEFAULT 1,
    [lastSyncedAt] DATETIME2,
    [lastHistoryId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [GmailIntegration_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GmailIntegration_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [GmailIntegration_workspaceId_email_key] UNIQUE NONCLUSTERED ([workspaceId],[email]),
    CONSTRAINT [GmailIntegration_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[BackgroundJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000),
    [activeScopeKey] VARCHAR(64),
    [idempotencyKey] VARCHAR(64),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BackgroundJob_status_df] DEFAULT 'PENDING',
    [workspaceId] NVARCHAR(1000),
    [userId] NVARCHAR(1000),
    [progress] INT NOT NULL CONSTRAINT [BackgroundJob_progress_df] DEFAULT 0,
    [total] INT,
    [current] INT,
    [message] NVARCHAR(1000),
    [payloadJson] NVARCHAR(max),
    [checkpointJson] NVARCHAR(max),
    [resultJson] NVARCHAR(max),
    [errorCode] NVARCHAR(1000),
    [error] NVARCHAR(max),
    [attempts] INT NOT NULL CONSTRAINT [BackgroundJob_attempts_df] DEFAULT 0,
    [retryCount] INT NOT NULL CONSTRAINT [BackgroundJob_retryCount_df] DEFAULT 0,
    [maxAttempts] INT NOT NULL CONSTRAINT [BackgroundJob_maxAttempts_df] DEFAULT 5,
    [duplicateCount] INT NOT NULL CONSTRAINT [BackgroundJob_duplicateCount_df] DEFAULT 0,
    [availableAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_availableAt_df] DEFAULT CURRENT_TIMESTAMP,
    [leaseToken] NVARCHAR(1000),
    [lockedAt] DATETIME2,
    [leaseExpiresAt] DATETIME2,
    [cancelRequestedAt] DATETIME2,
    [deadLetteredAt] DATETIME2,
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BackgroundJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MassiveMarketDataCache] (
    [cacheKey] NVARCHAR(450) NOT NULL,
    [payloadJson] NVARCHAR(max) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL CONSTRAINT [MassiveMarketDataCache_fetchedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [MassiveMarketDataCache_pkey] PRIMARY KEY CLUSTERED ([cacheKey])
);

-- CreateTable
CREATE TABLE [dbo].[MassiveApiThrottle] (
    [provider] NVARCHAR(100) NOT NULL,
    [nextAllowedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MassiveApiThrottle_pkey] PRIMARY KEY CLUSTERED ([provider])
);

-- CreateTable
CREATE TABLE [dbo].[SerpApiNewsCache] (
    [cacheKey] NVARCHAR(450) NOT NULL,
    [payloadJson] NVARCHAR(max) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL CONSTRAINT [SerpApiNewsCache_fetchedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [SerpApiNewsCache_pkey] PRIMARY KEY CLUSTERED ([cacheKey])
);

-- CreateTable
CREATE TABLE [dbo].[SerpApiQuota] (
    [provider] NVARCHAR(100) NOT NULL,
    [windowKey] NVARCHAR(32) NOT NULL,
    [requestCount] INT NOT NULL CONSTRAINT [SerpApiQuota_requestCount_df] DEFAULT 0,
    [nextAllowedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SerpApiQuota_pkey] PRIMARY KEY CLUSTERED ([provider])
);

-- CreateTable
CREATE TABLE [dbo].[InAppNotification] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000),
    [type] NVARCHAR(1000) NOT NULL,
    [dedupeKey] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(max) NOT NULL,
    [href] NVARCHAR(1000),
    [metadataJson] NVARCHAR(max),
    [readAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InAppNotification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InAppNotification_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [InAppNotification_userId_dedupeKey_key] UNIQUE NONCLUSTERED ([userId],[dedupeKey])
);

-- CreateTable
CREATE TABLE [dbo].[PasskeyCredential] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [credentialId] NVARCHAR(1000) NOT NULL,
    [publicKey] VARBINARY(max) NOT NULL,
    [counter] BIGINT NOT NULL CONSTRAINT [PasskeyCredential_counter_df] DEFAULT 0,
    [transports] NVARCHAR(1000),
    [deviceType] NVARCHAR(1000) NOT NULL,
    [backedUp] BIT NOT NULL CONSTRAINT [PasskeyCredential_backedUp_df] DEFAULT 0,
    [name] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PasskeyCredential_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastUsedAt] DATETIME2,
    CONSTRAINT [PasskeyCredential_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PasskeyCredential_credentialId_key] UNIQUE NONCLUSTERED ([credentialId])
);

-- CreateTable
CREATE TABLE [dbo].[WebAuthnChallenge] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [purpose] NVARCHAR(1000) NOT NULL,
    [challenge] NVARCHAR(1000) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WebAuthnChallenge_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WebAuthnChallenge_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [WebAuthnChallenge_challenge_key] UNIQUE NONCLUSTERED ([challenge])
);

-- CreateTable
CREATE TABLE [dbo].[PushSubscription] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [endpoint] NVARCHAR(1000) NOT NULL,
    [p256dh] NVARCHAR(1000) NOT NULL,
    [auth] NVARCHAR(1000) NOT NULL,
    [expirationTime] BIGINT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PushSubscription_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PushSubscription_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PushSubscription_endpoint_key] UNIQUE NONCLUSTERED ([endpoint])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_userId_idx] ON [dbo].[Account]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Workspace_publicNetWorthToken_idx] ON [dbo].[Workspace]([publicNetWorthToken]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkspaceInvite_workspaceId_status_idx] ON [dbo].[WorkspaceInvite]([workspaceId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkspaceInvite_invitedEmail_status_idx] ON [dbo].[WorkspaceInvite]([invitedEmail], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkspaceInvite_tokenHash_idx] ON [dbo].[WorkspaceInvite]([tokenHash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkspaceAuditLog_workspaceId_createdAt_idx] ON [dbo].[WorkspaceAuditLog]([workspaceId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InvestmentAccount_workspaceId_createdAt_idx] ON [dbo].[InvestmentAccount]([workspaceId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InvestmentEntry_accountId_date_idx] ON [dbo].[InvestmentEntry]([accountId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkspaceMember_userId_idx] ON [dbo].[WorkspaceMember]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SecurityRateLimit_updatedAt_idx] ON [dbo].[SecurityRateLimit]([updatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IntegrationOAuthState_expiresAt_idx] ON [dbo].[IntegrationOAuthState]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Month_workspaceId_sortOrder_idx] ON [dbo].[Month]([workspaceId], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FinancialAccount_workspaceId_kind_idx] ON [dbo].[FinancialAccount]([workspaceId], [kind]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BudgetEnvelope_workspaceId_accountId_idx] ON [dbo].[BudgetEnvelope]([workspaceId], [accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BudgetItem_workspaceId_idx] ON [dbo].[BudgetItem]([workspaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BudgetSource_workspaceId_idx] ON [dbo].[BudgetSource]([workspaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetSource_workspaceId_year_month_idx] ON [dbo].[MonthlyBudgetSource]([workspaceId], [year], [month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudget_workspaceId_year_month_idx] ON [dbo].[MonthlyBudget]([workspaceId], [year], [month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlan_workspaceId_status_idx] ON [dbo].[MonthlyBudgetPlan]([workspaceId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlanSource_planId_sortOrder_idx] ON [dbo].[MonthlyBudgetPlanSource]([planId], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlanSource_templateSourceId_idx] ON [dbo].[MonthlyBudgetPlanSource]([templateSourceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlanSource_ownerId_idx] ON [dbo].[MonthlyBudgetPlanSource]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlanItem_planId_sortOrder_idx] ON [dbo].[MonthlyBudgetPlanItem]([planId], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlanItem_templateItemId_idx] ON [dbo].[MonthlyBudgetPlanItem]([templateItemId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MonthlyBudgetPlanItem_destinationSubAccountId_idx] ON [dbo].[MonthlyBudgetPlanItem]([destinationSubAccountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_date_idx] ON [dbo].[Transaction]([workspaceId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_accountId_date_idx] ON [dbo].[Transaction]([accountId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_budgetId_date_idx] ON [dbo].[Transaction]([workspaceId], [budgetId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_groupId_date_idx] ON [dbo].[Transaction]([workspaceId], [groupId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_date_createdAt_id_idx] ON [dbo].[Transaction]([workspaceId], [date], [createdAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_direction_date_idx] ON [dbo].[Transaction]([workspaceId], [direction], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_budgetId_direction_date_idx] ON [dbo].[Transaction]([workspaceId], [budgetId], [direction], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_workspaceId_accountId_date_idx] ON [dbo].[Transaction]([workspaceId], [accountId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_postingGroupId_idx] ON [dbo].[Transaction]([postingGroupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_creditCardTransactionId_idx] ON [dbo].[Transaction]([creditCardTransactionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_receivableId_idx] ON [dbo].[Transaction]([receivableId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_reversalOfId_idx] ON [dbo].[Transaction]([reversalOfId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestTurn_workspaceId_userId_createdAt_idx] ON [dbo].[AskNestTurn]([workspaceId], [userId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestTurn_createdAt_totalTokens_idx] ON [dbo].[AskNestTurn]([createdAt], [totalTokens]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestTurn_feedbackRating_createdAt_idx] ON [dbo].[AskNestTurn]([feedbackRating], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestMemory_ownerHash_status_updatedAt_idx] ON [dbo].[AskNestMemory]([ownerHash], [status], [updatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestMemory_sourceTurnId_idx] ON [dbo].[AskNestMemory]([sourceTurnId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestUsageDaily_day_idx] ON [dbo].[AskNestUsageDaily]([day]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestUsageDaily_userId_day_idx] ON [dbo].[AskNestUsageDaily]([userId], [day]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AskNestUsageDaily_workspaceId_day_idx] ON [dbo].[AskNestUsageDaily]([workspaceId], [day]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PostingGroup_workspaceId_sourceType_sourceId_idx] ON [dbo].[PostingGroup]([workspaceId], [sourceType], [sourceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PostingGroup_reversalOfId_idx] ON [dbo].[PostingGroup]([reversalOfId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IdempotencyRecord_workspaceId_createdAt_idx] ON [dbo].[IdempotencyRecord]([workspaceId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TransactionGroup_workspaceId_budgetId_updatedAt_idx] ON [dbo].[TransactionGroup]([workspaceId], [budgetId], [updatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardAccount_workspaceId_isActive_idx] ON [dbo].[CreditCardAccount]([workspaceId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTxnLink_txDate_idx] ON [dbo].[CreditCardTxnLink]([txDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTxnLink_creditCardTransactionId_idx] ON [dbo].[CreditCardTxnLink]([creditCardTransactionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Receivable_workspaceId_status_idx] ON [dbo].[Receivable]([workspaceId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Receivable_sourceWorkspaceId_sourceBudgetId_status_idx] ON [dbo].[Receivable]([sourceWorkspaceId], [sourceBudgetId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Receivable_postingGroupId_idx] ON [dbo].[Receivable]([postingGroupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MileProgram_workspaceId_frequentFlyerId_date_idx] ON [dbo].[MileProgram]([workspaceId], [frequentFlyerId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MileRedemption_workspaceId_frequentFlyerId_dateTime_idx] ON [dbo].[MileRedemption]([workspaceId], [frequentFlyerId], [dateTime]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MileRedemptionDetail_redemptionId_idx] ON [dbo].[MileRedemptionDetail]([redemptionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LegacyRecordLink_targetModel_targetId_idx] ON [dbo].[LegacyRecordLink]([targetModel], [targetId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FrequentFlyerAccount_workspaceId_isActive_idx] ON [dbo].[FrequentFlyerAccount]([workspaceId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [HotelRewardAccount_workspaceId_isActive_idx] ON [dbo].[HotelRewardAccount]([workspaceId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardReward_workspaceId_idx] ON [dbo].[CreditCardReward]([workspaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PointConversion_workspaceId_idx] ON [dbo].[PointConversion]([workspaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PointConversion_creditCardRewardId_idx] ON [dbo].[PointConversion]([creditCardRewardId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PointConversion_frequentFlyerId_idx] ON [dbo].[PointConversion]([frequentFlyerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_workspaceId_idx] ON [dbo].[CreditCardTransaction]([workspaceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_creditCardId_idx] ON [dbo].[CreditCardTransaction]([creditCardId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_statementYear_statementMonth_idx] ON [dbo].[CreditCardTransaction]([statementYear], [statementMonth]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_transactionDate_idx] ON [dbo].[CreditCardTransaction]([transactionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_workspaceId_creditCardId_statementYear_statementMonth_transactionDate_idx] ON [dbo].[CreditCardTransaction]([workspaceId], [creditCardId], [statementYear], [statementMonth], [transactionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_workspaceId_statementYear_statementMonth_isAllocated_idx] ON [dbo].[CreditCardTransaction]([workspaceId], [statementYear], [statementMonth], [isAllocated]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_workspaceId_isAllocated_transactionDate_idx] ON [dbo].[CreditCardTransaction]([workspaceId], [isAllocated], [transactionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_workspaceId_paymentDueDate_idx] ON [dbo].[CreditCardTransaction]([workspaceId], [paymentDueDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CreditCardTransaction_workspaceId_creditCardId_transactionDate_idx] ON [dbo].[CreditCardTransaction]([workspaceId], [creditCardId], [transactionDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardAlertStaging_workspaceId_parseStatus_idx] ON [dbo].[CardAlertStaging]([workspaceId], [parseStatus]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardAlertStaging_workspaceId_createdAt_idx] ON [dbo].[CardAlertStaging]([workspaceId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardAlertStaging_workspaceId_transactionRef_idx] ON [dbo].[CardAlertStaging]([workspaceId], [transactionRef]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardAlertStaging_sourceMessageKey_idx] ON [dbo].[CardAlertStaging]([sourceMessageKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardAlertStaging_transactionKey_idx] ON [dbo].[CardAlertStaging]([transactionKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CardAlertStaging_creditTransactionId_idx] ON [dbo].[CardAlertStaging]([creditTransactionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GmailIntegration_workspaceId_isActive_idx] ON [dbo].[GmailIntegration]([workspaceId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackgroundJob_type_status_createdAt_idx] ON [dbo].[BackgroundJob]([type], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackgroundJob_key_status_idx] ON [dbo].[BackgroundJob]([key], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackgroundJob_activeScopeKey_idx] ON [dbo].[BackgroundJob]([activeScopeKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackgroundJob_idempotencyKey_idx] ON [dbo].[BackgroundJob]([idempotencyKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackgroundJob_status_availableAt_idx] ON [dbo].[BackgroundJob]([status], [availableAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BackgroundJob_leaseExpiresAt_idx] ON [dbo].[BackgroundJob]([leaseExpiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MassiveMarketDataCache_expiresAt_idx] ON [dbo].[MassiveMarketDataCache]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SerpApiNewsCache_expiresAt_idx] ON [dbo].[SerpApiNewsCache]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InAppNotification_userId_workspaceId_readAt_updatedAt_idx] ON [dbo].[InAppNotification]([userId], [workspaceId], [readAt], [updatedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InAppNotification_workspaceId_type_idx] ON [dbo].[InAppNotification]([workspaceId], [type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PasskeyCredential_userId_createdAt_idx] ON [dbo].[PasskeyCredential]([userId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WebAuthnChallenge_userId_purpose_expiresAt_idx] ON [dbo].[WebAuthnChallenge]([userId], [purpose], [expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WebAuthnChallenge_purpose_expiresAt_idx] ON [dbo].[WebAuthnChallenge]([purpose], [expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PushSubscription_userId_updatedAt_idx] ON [dbo].[PushSubscription]([userId], [updatedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
