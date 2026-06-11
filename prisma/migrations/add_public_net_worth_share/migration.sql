ALTER TABLE [dbo].[Workspace]
ADD [publicNetWorthEnabled] BIT NOT NULL CONSTRAINT [Workspace_publicNetWorthEnabled_df] DEFAULT 0,
    [publicNetWorthToken] NVARCHAR(1000);

CREATE INDEX [Workspace_publicNetWorthToken_idx]
ON [dbo].[Workspace]([publicNetWorthToken]);
