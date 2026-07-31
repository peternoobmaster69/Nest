BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[BudgetEnvelope]
    ADD [isSavings] BIT NOT NULL
      CONSTRAINT [BudgetEnvelope_isSavings_df] DEFAULT 0;

  -- Preserve the savings classification used by the legacy UI before the
  -- classification became an explicit field.
  EXEC(N'
    UPDATE [dbo].[BudgetEnvelope]
    SET [isSavings] = 1
    WHERE CONVERT(VARBINARY(MAX), [icon]) IN (0x3DD8E1DE, 0x3DD8E1DE0FFE)
       OR LOWER([name]) LIKE N''%savings%''
       OR LOWER([name]) LIKE N''%emergency%'';
  ');

  EXEC(N'
    CREATE NONCLUSTERED INDEX [BudgetEnvelope_workspaceId_isSavings_isActive_idx]
      ON [dbo].[BudgetEnvelope]([workspaceId], [isSavings], [isActive]);
  ');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
