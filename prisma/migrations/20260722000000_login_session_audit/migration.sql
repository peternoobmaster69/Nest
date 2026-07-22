BEGIN TRY
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[LoginSession] (
    [id] NVARCHAR(1000) NOT NULL,
    [sessionId] VARCHAR(64) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [provider] VARCHAR(64),
    [ipAddress] VARCHAR(45),
    [countryCode] VARCHAR(2),
    [signedInAt] DATETIME2 NOT NULL CONSTRAINT [LoginSession_signedInAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LoginSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LoginSession_sessionId_key] UNIQUE NONCLUSTERED ([sessionId]),
    CONSTRAINT [LoginSession_userId_fkey]
      FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE INDEX [LoginSession_userId_signedInAt_idx]
    ON [dbo].[LoginSession]([userId], [signedInAt]);
  CREATE INDEX [LoginSession_signedInAt_idx]
    ON [dbo].[LoginSession]([signedInAt]);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
