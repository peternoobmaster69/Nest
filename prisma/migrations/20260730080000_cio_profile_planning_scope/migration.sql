BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[CioHouseholdProfile]
    ADD [planningScope] VARCHAR(16) NULL;

  EXEC(N'
    UPDATE [dbo].[CioHouseholdProfile]
    SET [planningScope] = CASE
      WHEN [partnerBirthDate] IS NULL THEN ''INDIVIDUAL''
      ELSE ''HOUSEHOLD''
    END;
  ');

  EXEC(N'
    ALTER TABLE [dbo].[CioHouseholdProfile]
      ALTER COLUMN [planningScope] VARCHAR(16) NOT NULL;
  ');

  EXEC(N'
    ALTER TABLE [dbo].[CioHouseholdProfile]
      ADD CONSTRAINT [CioHouseholdProfile_planningScope_df]
      DEFAULT ''INDIVIDUAL'' FOR [planningScope];
  ');

  EXEC(N'
    ALTER TABLE [dbo].[CioHouseholdProfile] WITH CHECK ADD CONSTRAINT [CioHouseholdProfile_planningScope_check] CHECK (
      [planningScope] IN (''INDIVIDUAL'', ''HOUSEHOLD'') AND
      ([planningScope] = ''HOUSEHOLD'' OR [partnerBirthDate] IS NULL)
    );
  ');

  EXEC(N'
    ALTER TABLE [dbo].[CioHouseholdProfile]
      CHECK CONSTRAINT [CioHouseholdProfile_planningScope_check];
  ');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
