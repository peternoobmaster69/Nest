-- Abort instead of switching the application to a partially reconciled backfill.
IF EXISTS (
  SELECT 1
  FROM (
    SELECT [workspaceId], [year], [month], SUM([allocatedCents]) AS [amountCents]
    FROM [dbo].[MonthlyBudget]
    GROUP BY [workspaceId], [year], [month]
  ) AS [legacy]
  INNER JOIN [dbo].[MonthlyBudgetPlan] AS [plan]
    ON [plan].[workspaceId] = [legacy].[workspaceId]
   AND [plan].[year] = [legacy].[year]
   AND [plan].[month] = [legacy].[month]
  OUTER APPLY (
    SELECT COALESCE(SUM([amountCents]), 0) AS [amountCents]
    FROM [dbo].[MonthlyBudgetPlanItem]
    WHERE [planId] = [plan].[id]
  ) AS [migrated]
  WHERE [legacy].[amountCents] <> [migrated].[amountCents]
)
  THROW 51000, 'Monthly budget item totals did not reconcile during migration.', 1;

IF EXISTS (
  SELECT 1
  FROM (
    SELECT [workspaceId], [year], [month], SUM([amountCents]) AS [amountCents]
    FROM [dbo].[MonthlyBudgetSource]
    GROUP BY [workspaceId], [year], [month]
  ) AS [legacy]
  INNER JOIN [dbo].[MonthlyBudgetPlan] AS [plan]
    ON [plan].[workspaceId] = [legacy].[workspaceId]
   AND [plan].[year] = [legacy].[year]
   AND [plan].[month] = [legacy].[month]
  OUTER APPLY (
    SELECT COALESCE(SUM([amountCents]), 0) AS [amountCents]
    FROM [dbo].[MonthlyBudgetPlanSource]
    WHERE [planId] = [plan].[id]
  ) AS [migrated]
  WHERE [legacy].[amountCents] <> [migrated].[amountCents]
)
  THROW 51001, 'Monthly budget source totals did not reconcile during migration.', 1;
