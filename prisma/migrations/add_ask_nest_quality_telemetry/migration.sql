ALTER TABLE [dbo].[AskNestTurn] ADD
  [diagnosticsJson] NVARCHAR(MAX) NULL,
  [toolCallCount] INT NOT NULL CONSTRAINT [AskNestTurn_toolCallCount_df] DEFAULT 0,
  [emptyResultCount] INT NOT NULL CONSTRAINT [AskNestTurn_emptyResultCount_df] DEFAULT 0,
  [durationMs] INT NULL,
  [feedbackRating] NVARCHAR(1000) NULL,
  [feedbackReason] NVARCHAR(1000) NULL,
  [feedbackAt] DATETIME2 NULL;

CREATE INDEX [AskNestTurn_feedbackRating_createdAt_idx]
ON [dbo].[AskNestTurn]([feedbackRating], [createdAt]);

ALTER TABLE [dbo].[AskNestUsageDaily] ADD
  [toolCallCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_toolCallCount_df] DEFAULT 0,
  [emptyResultCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_emptyResultCount_df] DEFAULT 0,
  [totalDurationMs] INT NOT NULL CONSTRAINT [AskNestUsageDaily_totalDurationMs_df] DEFAULT 0,
  [feedbackCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_feedbackCount_df] DEFAULT 0,
  [helpfulCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_helpfulCount_df] DEFAULT 0,
  [notHelpfulCount] INT NOT NULL CONSTRAINT [AskNestUsageDaily_notHelpfulCount_df] DEFAULT 0;
