-- Phase 5: durable, scoped background jobs and resumable integration ingestion.

ALTER TABLE [dbo].[CardAlertStaging] ADD
  [sourceMessageKey] VARCHAR(64) NULL,
  [transactionKey] VARCHAR(64) NULL,
  [contentHash] VARCHAR(64) NULL,
  [processingStartedAt] DATETIME2 NULL;

CREATE UNIQUE NONCLUSTERED INDEX [CardAlertStaging_sourceMessageKey_key]
  ON [dbo].[CardAlertStaging]([sourceMessageKey])
  WHERE [sourceMessageKey] IS NOT NULL;
CREATE NONCLUSTERED INDEX [CardAlertStaging_sourceMessageKey_idx]
  ON [dbo].[CardAlertStaging]([sourceMessageKey]);
CREATE UNIQUE NONCLUSTERED INDEX [CardAlertStaging_transactionKey_key]
  ON [dbo].[CardAlertStaging]([transactionKey])
  WHERE [transactionKey] IS NOT NULL;
CREATE NONCLUSTERED INDEX [CardAlertStaging_transactionKey_idx]
  ON [dbo].[CardAlertStaging]([transactionKey]);

ALTER TABLE [dbo].[BackgroundJob] ADD
  [activeScopeKey] VARCHAR(64) NULL,
  [idempotencyKey] VARCHAR(64) NULL,
  [payloadJson] NVARCHAR(MAX) NULL,
  [checkpointJson] NVARCHAR(MAX) NULL,
  [errorCode] NVARCHAR(1000) NULL,
  [attempts] INT NOT NULL CONSTRAINT [BackgroundJob_attempts_df] DEFAULT 0,
  [retryCount] INT NOT NULL CONSTRAINT [BackgroundJob_retryCount_df] DEFAULT 0,
  [maxAttempts] INT NOT NULL CONSTRAINT [BackgroundJob_maxAttempts_df] DEFAULT 5,
  [duplicateCount] INT NOT NULL CONSTRAINT [BackgroundJob_duplicateCount_df] DEFAULT 0,
  [availableAt] DATETIME2 NOT NULL CONSTRAINT [BackgroundJob_availableAt_df] DEFAULT CURRENT_TIMESTAMP,
  [leaseToken] NVARCHAR(1000) NULL,
  [cancelRequestedAt] DATETIME2 NULL,
  [deadLetteredAt] DATETIME2 NULL;

-- Existing jobs remain historical records. New jobs exclusively own their active scope.
CREATE UNIQUE NONCLUSTERED INDEX [BackgroundJob_activeScopeKey_key]
  ON [dbo].[BackgroundJob]([activeScopeKey])
  WHERE [activeScopeKey] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [BackgroundJob_idempotencyKey_key]
  ON [dbo].[BackgroundJob]([idempotencyKey])
  WHERE [idempotencyKey] IS NOT NULL;
CREATE NONCLUSTERED INDEX [BackgroundJob_activeScopeKey_idx]
  ON [dbo].[BackgroundJob]([activeScopeKey]);
CREATE NONCLUSTERED INDEX [BackgroundJob_idempotencyKey_idx]
  ON [dbo].[BackgroundJob]([idempotencyKey]);
CREATE NONCLUSTERED INDEX [BackgroundJob_status_availableAt_idx]
  ON [dbo].[BackgroundJob]([status], [availableAt]);
