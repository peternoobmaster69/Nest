ALTER TABLE [dbo].[AskNestTurn]
ADD [inputTokens] INT NULL,
    [outputTokens] INT NULL,
    [totalTokens] INT NULL;

CREATE INDEX [AskNestTurn_createdAt_totalTokens_idx]
ON [dbo].[AskNestTurn]([createdAt], [totalTokens]);
