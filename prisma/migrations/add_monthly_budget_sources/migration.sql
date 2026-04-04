CREATE TABLE [dbo].[MonthlyBudgetSource] (
  [id] NVARCHAR(1000) NOT NULL,
  [workspaceId] NVARCHAR(1000) NOT NULL,
  [budgetSourceId] NVARCHAR(1000) NOT NULL,
  [year] INT NOT NULL,
  [month] INT NOT NULL,
  [title] NVARCHAR(1000) NOT NULL,
  [ownerId] NVARCHAR(1000) NOT NULL,
  [amountCents] INT NOT NULL CONSTRAINT [MonthlyBudgetSource_amountCents_df] DEFAULT 0,
  [isDraft] BIT NOT NULL CONSTRAINT [MonthlyBudgetSource_isDraft_df] DEFAULT 1,
  [confirmedAt] DATETIME2 NULL,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetSource_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [MonthlyBudgetSource_pkey] PRIMARY KEY ([id])
);

CREATE UNIQUE INDEX [MonthlyBudgetSource_workspaceId_year_month_budgetSourceId_key]
ON [dbo].[MonthlyBudgetSource]([workspaceId], [year], [month], [budgetSourceId]);

CREATE INDEX [MonthlyBudgetSource_workspaceId_year_month_idx]
ON [dbo].[MonthlyBudgetSource]([workspaceId], [year], [month]);

INSERT INTO [dbo].[MonthlyBudgetSource] (
  [id],
  [workspaceId],
  [budgetSourceId],
  [year],
  [month],
  [title],
  [ownerId],
  [amountCents],
  [isDraft],
  [confirmedAt],
  [createdAt],
  [updatedAt]
)
SELECT
  NEWID(),
  mb.[workspaceId],
  mb.[budgetSourceId],
  mb.[year],
  mb.[month],
  COALESCE(bs.[title], mb.[budgetSourceTitle], N'Budget Source'),
  bs.[ownerId],
  COALESCE(bs.[amountCents], 0),
  CASE WHEN MAX(CASE WHEN mb.[isDraft] = 1 THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END,
  MAX(mb.[confirmedAt]),
  MIN(mb.[createdAt]),
  MAX(mb.[updatedAt])
FROM [dbo].[MonthlyBudget] mb
LEFT JOIN [dbo].[BudgetSource] bs ON bs.[id] = mb.[budgetSourceId]
WHERE NOT EXISTS (
  SELECT 1
  FROM [dbo].[MonthlyBudgetSource] mbs
  WHERE mbs.[workspaceId] = mb.[workspaceId]
    AND mbs.[year] = mb.[year]
    AND mbs.[month] = mb.[month]
    AND mbs.[budgetSourceId] = mb.[budgetSourceId]
)
GROUP BY
  mb.[workspaceId],
  mb.[budgetSourceId],
  mb.[year],
  mb.[month],
  bs.[title],
  mb.[budgetSourceTitle],
  bs.[ownerId],
  bs.[amountCents];
