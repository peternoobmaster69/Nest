BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (
    SELECT 1
    FROM [dbo].[CioRecurringFlow]
    WHERE
      ([sourceFinancialAccountId] IS NOT NULL AND [sourceInvestmentAccountId] IS NOT NULL) OR
      ([sourceInvestmentAccountId] IS NOT NULL AND [sourceInvestmentAccountId] = [destinationInvestmentAccountId]) OR
      ([type] = 'EXTERNAL_CONTRIBUTION' AND
        ([sourceFinancialAccountId] IS NOT NULL OR [sourceInvestmentAccountId] IS NOT NULL)) OR
      ([type] = 'INTERNAL_REALLOCATION' AND
        ([destinationInvestmentAccountId] IS NULL OR
         (([sourceFinancialAccountId] IS NULL AND [sourceInvestmentAccountId] IS NULL) OR
          ([sourceFinancialAccountId] IS NOT NULL AND [sourceInvestmentAccountId] IS NOT NULL)))) OR
      ([type] <> 'INTERNAL_REALLOCATION' AND [destinationInvestmentAccountId] IS NOT NULL AND
        ([sourceFinancialAccountId] IS NOT NULL OR [sourceInvestmentAccountId] IS NOT NULL))
  )
  BEGIN
    ;THROW 51000, 'Existing CIO recurring flows violate the stricter source and destination invariant.', 1;
  END;

  ALTER TABLE [dbo].[CioRecurringFlow]
    DROP CONSTRAINT [CioRecurringFlow_source_check];

  ALTER TABLE [dbo].[CioRecurringFlow] WITH CHECK ADD CONSTRAINT [CioRecurringFlow_source_check] CHECK (
    ([sourceFinancialAccountId] IS NULL OR [sourceInvestmentAccountId] IS NULL) AND
    ([sourceInvestmentAccountId] IS NULL OR [destinationInvestmentAccountId] IS NULL OR [sourceInvestmentAccountId] <> [destinationInvestmentAccountId]) AND
    ([type] <> 'EXTERNAL_CONTRIBUTION' OR ([sourceFinancialAccountId] IS NULL AND [sourceInvestmentAccountId] IS NULL)) AND
    ([type] <> 'INTERNAL_REALLOCATION' OR
      ([destinationInvestmentAccountId] IS NOT NULL AND
       (([sourceFinancialAccountId] IS NOT NULL AND [sourceInvestmentAccountId] IS NULL) OR
        ([sourceFinancialAccountId] IS NULL AND [sourceInvestmentAccountId] IS NOT NULL)))) AND
    ([type] = 'INTERNAL_REALLOCATION' OR [sourceFinancialAccountId] IS NULL OR [destinationInvestmentAccountId] IS NULL) AND
    ([type] = 'INTERNAL_REALLOCATION' OR [sourceInvestmentAccountId] IS NULL OR [destinationInvestmentAccountId] IS NULL)
  );

  ALTER TABLE [dbo].[CioRecurringFlow]
    CHECK CONSTRAINT [CioRecurringFlow_source_check];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
