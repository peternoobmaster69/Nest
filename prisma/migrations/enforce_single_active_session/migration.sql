BEGIN TRANSACTION;

ALTER TABLE [dbo].[User] ADD
  [activeSessionId] NVARCHAR(1000),
  [activeSessionExpiresAt] DATETIME2,
  [lastSignedInAt] DATETIME2;

COMMIT TRANSACTION;
