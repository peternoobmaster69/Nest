SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE [parent_object_id] = OBJECT_ID(N'[dbo].[MonthlyBudgetPlan]')
      AND [name] = N'MonthlyBudgetPlan_status_check'
  )
    ALTER TABLE [dbo].[MonthlyBudgetPlan]
      DROP CONSTRAINT [MonthlyBudgetPlan_status_check];

  ALTER TABLE [dbo].[MonthlyBudgetPlan] WITH CHECK
    ADD CONSTRAINT [MonthlyBudgetPlan_status_check]
      CHECK ([status] IN (N'DRAFT', N'REVIEW', N'CONFIRMING', N'CONFIRMED'));

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
