CREATE TABLE [dbo].[AskNestTurn] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [question] NVARCHAR(MAX) NOT NULL,
    [answerJson] NVARCHAR(MAX) NOT NULL,
    [pagePath] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AskNestTurn_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AskNestTurn_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE INDEX [AskNestTurn_workspaceId_userId_createdAt_idx]
ON [dbo].[AskNestTurn]([workspaceId], [userId], [createdAt]);
