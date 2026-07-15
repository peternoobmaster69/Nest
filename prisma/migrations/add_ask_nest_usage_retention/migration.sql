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
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AskNestUsageDaily_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [AskNestUsageDaily_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AskNestUsageDaily_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AskNestUsageDaily_day_workspaceId_userId_key] UNIQUE NONCLUSTERED ([day], [workspaceId], [userId])
);

CREATE INDEX [AskNestUsageDaily_day_idx] ON [dbo].[AskNestUsageDaily]([day]);
CREATE INDEX [AskNestUsageDaily_userId_day_idx] ON [dbo].[AskNestUsageDaily]([userId], [day]);
CREATE INDEX [AskNestUsageDaily_workspaceId_day_idx] ON [dbo].[AskNestUsageDaily]([workspaceId], [day]);
