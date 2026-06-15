CREATE INDEX [Transaction_workspaceId_date_createdAt_id_idx]
ON [dbo].[Transaction]([workspaceId], [date], [createdAt], [id]);

CREATE INDEX [Transaction_workspaceId_direction_date_idx]
ON [dbo].[Transaction]([workspaceId], [direction], [date]);

CREATE INDEX [Transaction_workspaceId_budgetId_direction_date_idx]
ON [dbo].[Transaction]([workspaceId], [budgetId], [direction], [date]);

CREATE INDEX [Transaction_workspaceId_accountId_date_idx]
ON [dbo].[Transaction]([workspaceId], [accountId], [date]);

CREATE INDEX [CreditCardTransaction_workspaceId_creditCardId_statementYear_statementMonth_transactionDate_idx]
ON [dbo].[CreditCardTransaction]([workspaceId], [creditCardId], [statementYear], [statementMonth], [transactionDate]);

CREATE INDEX [CreditCardTransaction_workspaceId_statementYear_statementMonth_isAllocated_idx]
ON [dbo].[CreditCardTransaction]([workspaceId], [statementYear], [statementMonth], [isAllocated]);

CREATE INDEX [CreditCardTransaction_workspaceId_isAllocated_transactionDate_idx]
ON [dbo].[CreditCardTransaction]([workspaceId], [isAllocated], [transactionDate]);

CREATE INDEX [CreditCardTransaction_workspaceId_paymentDueDate_idx]
ON [dbo].[CreditCardTransaction]([workspaceId], [paymentDueDate]);

CREATE INDEX [CreditCardTransaction_workspaceId_creditCardId_transactionDate_idx]
ON [dbo].[CreditCardTransaction]([workspaceId], [creditCardId], [transactionDate]);

CREATE INDEX [CardAlertStaging_workspaceId_transactionRef_idx]
ON [dbo].[CardAlertStaging]([workspaceId], [transactionRef]);

CREATE TABLE [dbo].[BackgroundJob] (
    [id] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BackgroundJob_status_df] DEFAULT 'PENDING',
    [workspaceId] NVARCHAR(1000),
    [userId] NVARCHAR(1000),
    [progress] INT NOT NULL CONSTRAINT [BackgroundJob_progress_df] DEFAULT 0,
    [total] INT,
    [current] INT,
    [message] NVARCHAR(1000),
    [resultJson] NVARCHAR(MAX),
    [error] NVARCHAR(MAX),
    [lockedAt] DATETIME2,
    [leaseExpiresAt] DATETIME2,
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BackgroundJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [BackgroundJob_type_status_createdAt_idx]
ON [dbo].[BackgroundJob]([type], [status], [createdAt]);

CREATE INDEX [BackgroundJob_key_status_idx]
ON [dbo].[BackgroundJob]([key], [status]);

CREATE INDEX [BackgroundJob_leaseExpiresAt_idx]
ON [dbo].[BackgroundJob]([leaseExpiresAt]);
