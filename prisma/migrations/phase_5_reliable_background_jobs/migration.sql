-- Phase 5: durable, scoped background jobs and resumable integration ingestion.

SET XACT_ABORT ON;

BEGIN TRY
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.CardAlertStaging', N'sourceMessageKey') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [sourceMessageKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.CardAlertStaging', N'transactionKey') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [transactionKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.CardAlertStaging', N'contentHash') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [contentHash] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.CardAlertStaging', N'processingStartedAt') IS NULL ALTER TABLE [dbo].[CardAlertStaging] ADD [processingStartedAt] DATETIME2 NULL;

-- SQL Server compiles a batch before executing ALTER TABLE. Defer index
-- compilation so the newly added columns are visible when each statement runs.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_sourceMessageKey_key') EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [CardAlertStaging_sourceMessageKey_key]
  ON [dbo].[CardAlertStaging]([sourceMessageKey])
  WHERE [sourceMessageKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_sourceMessageKey_idx') EXEC(N'CREATE NONCLUSTERED INDEX [CardAlertStaging_sourceMessageKey_idx]
  ON [dbo].[CardAlertStaging]([sourceMessageKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_transactionKey_key') EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [CardAlertStaging_transactionKey_key]
  ON [dbo].[CardAlertStaging]([transactionKey])
  WHERE [transactionKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[CardAlertStaging]') AND [name] = N'CardAlertStaging_transactionKey_idx') EXEC(N'CREATE NONCLUSTERED INDEX [CardAlertStaging_transactionKey_idx]
  ON [dbo].[CardAlertStaging]([transactionKey])');

IF COL_LENGTH(N'dbo.BackgroundJob', N'activeScopeKey') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [activeScopeKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'idempotencyKey') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [idempotencyKey] VARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'payloadJson') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [payloadJson] NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'checkpointJson') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [checkpointJson] NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'errorCode') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [errorCode] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'attempts') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [attempts] INT NOT NULL CONSTRAINT [BackgroundJob_attempts_df] DEFAULT 0;
IF COL_LENGTH(N'dbo.BackgroundJob', N'retryCount') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [retryCount] INT NOT NULL CONSTRAINT [BackgroundJob_retryCount_df] DEFAULT 0;
IF COL_LENGTH(N'dbo.BackgroundJob', N'maxAttempts') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [maxAttempts] INT NOT NULL CONSTRAINT [BackgroundJob_maxAttempts_df] DEFAULT 5;
IF COL_LENGTH(N'dbo.BackgroundJob', N'duplicateCount') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [duplicateCount] INT NOT NULL CONSTRAINT [BackgroundJob_duplicateCount_df] DEFAULT 0;
IF COL_LENGTH(N'dbo.BackgroundJob', N'availableAt') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [availableAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_availableAt_df] DEFAULT CURRENT_TIMESTAMP;
IF COL_LENGTH(N'dbo.BackgroundJob', N'leaseToken') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [leaseToken] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'cancelRequestedAt') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [cancelRequestedAt] DATETIME2 NULL;
IF COL_LENGTH(N'dbo.BackgroundJob', N'deadLetteredAt') IS NULL ALTER TABLE [dbo].[BackgroundJob] ADD [deadLetteredAt] DATETIME2 NULL;

-- Existing jobs remain historical records. New jobs exclusively own their active scope.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_activeScopeKey_key') EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [BackgroundJob_activeScopeKey_key]
  ON [dbo].[BackgroundJob]([activeScopeKey])
  WHERE [activeScopeKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_idempotencyKey_key') EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [BackgroundJob_idempotencyKey_key]
  ON [dbo].[BackgroundJob]([idempotencyKey])
  WHERE [idempotencyKey] IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_activeScopeKey_idx') EXEC(N'CREATE NONCLUSTERED INDEX [BackgroundJob_activeScopeKey_idx]
  ON [dbo].[BackgroundJob]([activeScopeKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_idempotencyKey_idx') EXEC(N'CREATE NONCLUSTERED INDEX [BackgroundJob_idempotencyKey_idx]
  ON [dbo].[BackgroundJob]([idempotencyKey])');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[BackgroundJob]') AND [name] = N'BackgroundJob_status_availableAt_idx') EXEC(N'CREATE NONCLUSTERED INDEX [BackgroundJob_status_availableAt_idx]
  ON [dbo].[BackgroundJob]([status], [availableAt])');

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
