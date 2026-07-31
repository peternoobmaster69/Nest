BEGIN TRY
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[CioStrategyReport] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [createdByUserId] NVARCHAR(1000) NULL,
    [title] NVARCHAR(240) NOT NULL,
    [asOfDate] DATETIME2 NOT NULL,
    [strategyStatus] VARCHAR(24) NOT NULL,
    [completenessBps] INT NOT NULL,
    [recommendationCount] INT NOT NULL,
    [schemaVersion] VARCHAR(16) NOT NULL,
    [rendererVersion] VARCHAR(16) NOT NULL,
    [contentHash] VARCHAR(64) NOT NULL,
    [reportJson] NVARCHAR(MAX) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioStrategyReport_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CioStrategyReport_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioStrategyReport_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId], [id]),
    CONSTRAINT [CioStrategyReport_status_check] CHECK ([strategyStatus] IN ('SETUP_REQUIRED','ACTION_REQUIRED','ON_TRACK')),
    CONSTRAINT [CioStrategyReport_completeness_check] CHECK ([completenessBps] BETWEEN 0 AND 10000),
    CONSTRAINT [CioStrategyReport_recommendation_count_check] CHECK ([recommendationCount] BETWEEN 0 AND 12),
    CONSTRAINT [CioStrategyReport_content_hash_check] CHECK (LEN([contentHash]) = 64)
  );

  CREATE NONCLUSTERED INDEX [CioStrategyReport_workspaceId_createdAt_idx]
    ON [dbo].[CioStrategyReport]([workspaceId], [createdAt]);
  CREATE NONCLUSTERED INDEX [CioStrategyReport_createdByUserId_idx]
    ON [dbo].[CioStrategyReport]([createdByUserId]);
  CREATE NONCLUSTERED INDEX [CioStrategyReport_contentHash_idx]
    ON [dbo].[CioStrategyReport]([contentHash]);

  -- relationMode is `prisma`; physical NO ACTION keys enforce ownership while
  -- Prisma retains the declared Cascade/SetNull delete behavior.
  ALTER TABLE [dbo].[CioStrategyReport] WITH CHECK ADD CONSTRAINT [CioStrategyReport_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioStrategyReport] WITH CHECK ADD CONSTRAINT [CioStrategyReport_creator_fkey]
    FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
