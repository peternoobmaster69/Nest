BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[LoginSession] ADD
    [deviceName] NVARCHAR(160) NOT NULL
      CONSTRAINT [LoginSession_deviceName_df] DEFAULT N'Unknown device',
    [status] VARCHAR(16) NOT NULL
      CONSTRAINT [LoginSession_status_df] DEFAULT 'ACTIVE',
    [lastSeenAt] DATETIME2 NOT NULL
      CONSTRAINT [LoginSession_lastSeenAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2,
    [revokedAt] DATETIME2;

  /* SQL Server compiles a batch before ALTER TABLE exposes its new columns. */
  EXEC sys.sp_executesql N'
    UPDATE [session]
    SET
      [status] = CASE
        WHEN [user].[activeSessionId] = [session].[sessionId]
          AND ([user].[activeSessionExpiresAt] IS NULL OR [user].[activeSessionExpiresAt] > CURRENT_TIMESTAMP)
          THEN ''ACTIVE''
        ELSE ''REVOKED''
      END,
      [lastSeenAt] = [session].[signedInAt],
      [expiresAt] = COALESCE(
        CASE WHEN [user].[activeSessionId] = [session].[sessionId]
          THEN [user].[activeSessionExpiresAt]
        END,
        DATEADD(DAY, 30, [session].[signedInAt])
      ),
      [revokedAt] = CASE
        WHEN [user].[activeSessionId] = [session].[sessionId]
          AND ([user].[activeSessionExpiresAt] IS NULL OR [user].[activeSessionExpiresAt] > CURRENT_TIMESTAMP)
          THEN NULL
        ELSE CURRENT_TIMESTAMP
      END
    FROM [dbo].[LoginSession] AS [session]
    INNER JOIN [dbo].[User] AS [user] ON [user].[id] = [session].[userId];

    ALTER TABLE [dbo].[LoginSession] ALTER COLUMN [expiresAt] DATETIME2 NOT NULL;
    ALTER TABLE [dbo].[LoginSession] ADD CONSTRAINT [LoginSession_expiresAt_df]
      DEFAULT (DATEADD(DAY, 30, GETDATE())) FOR [expiresAt];
    ALTER TABLE [dbo].[LoginSession] ADD CONSTRAINT [LoginSession_status_check]
      CHECK ([status] IN (''ACTIVE'', ''PENDING'', ''REVOKED''));

    CREATE INDEX [LoginSession_userId_status_expiresAt_idx]
      ON [dbo].[LoginSession]([userId], [status], [expiresAt]);
  ';

  /* Keep the legacy User columns during rollout; LoginSession is authoritative. */

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
