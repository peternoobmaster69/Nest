ALTER TABLE [dbo].[Workspace]
ADD [creditCardAutoRules] NVARCHAR(MAX);

ALTER TABLE [dbo].[Receivable]
ADD [sourceWorkspaceId] NVARCHAR(1000),
    [sourceAccountId] NVARCHAR(1000),
    [sourceBudgetId] NVARCHAR(1000);

CREATE INDEX [Receivable_sourceWorkspaceId_sourceBudgetId_status_idx]
ON [dbo].[Receivable]([sourceWorkspaceId], [sourceBudgetId], [status]);
