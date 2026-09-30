CREATE TABLE [dbo].[TransactionAgentDraft] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [revision] INT NOT NULL CONSTRAINT [TransactionAgentDraft_revision_df] DEFAULT 0,
    [status] VARCHAR(16) NOT NULL CONSTRAINT [TransactionAgentDraft_status_df] DEFAULT 'CLARIFY',
    [stateJson] NVARCHAR(MAX) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TransactionAgentDraft_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TransactionAgentDraft_pkey] PRIMARY KEY CLUSTERED ([id])
);
CREATE NONCLUSTERED INDEX [TransactionAgentDraft_workspaceId_userId_updatedAt_idx]
ON [dbo].[TransactionAgentDraft]([workspaceId], [userId], [updatedAt]);
CREATE NONCLUSTERED INDEX [TransactionAgentDraft_userId_idx] ON [dbo].[TransactionAgentDraft]([userId]);
CREATE NONCLUSTERED INDEX [TransactionAgentDraft_expiresAt_idx] ON [dbo].[TransactionAgentDraft]([expiresAt]);
