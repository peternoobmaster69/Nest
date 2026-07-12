CREATE TABLE [dbo].[TransactionGroup] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [budgetId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [icon] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TransactionGroup_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [TransactionGroup_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TransactionGroup_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [TransactionGroup_workspaceId_budgetId_updatedAt_idx]
ON [dbo].[TransactionGroup]([workspaceId], [budgetId], [updatedAt]);

ALTER TABLE [dbo].[Transaction] ADD [groupId] NVARCHAR(1000) NULL;

CREATE INDEX [Transaction_workspaceId_groupId_date_idx]
ON [dbo].[Transaction]([workspaceId], [groupId], [date]);
