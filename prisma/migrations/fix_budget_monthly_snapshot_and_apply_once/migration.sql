ALTER TABLE [dbo].[MonthlyBudget] ADD [budgetItemTitle] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[MonthlyBudget] ADD [budgetSourceTitle] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[MonthlyBudget] ADD [destinationSubAccountId] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[MonthlyBudget] ADD [appliedAt] DATETIME2 NULL;
