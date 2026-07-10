CREATE TABLE [dbo].[MonthlyBudgetPlan] (
  [id] NVARCHAR(1000) NOT NULL,
  [workspaceId] NVARCHAR(1000) NOT NULL,
  [year] INT NOT NULL,
  [month] INT NOT NULL,
  [status] NVARCHAR(1000) NOT NULL CONSTRAINT [MonthlyBudgetPlan_status_df] DEFAULT N'DRAFT',
  [confirmedAt] DATETIME2 NULL,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetPlan_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [MonthlyBudgetPlan_pkey] PRIMARY KEY ([id])
);

CREATE UNIQUE INDEX [MonthlyBudgetPlan_workspaceId_year_month_key]
ON [dbo].[MonthlyBudgetPlan]([workspaceId], [year], [month]);

CREATE INDEX [MonthlyBudgetPlan_workspaceId_status_idx]
ON [dbo].[MonthlyBudgetPlan]([workspaceId], [status]);

CREATE TABLE [dbo].[MonthlyBudgetPlanSource] (
  [id] NVARCHAR(1000) NOT NULL,
  [planId] NVARCHAR(1000) NOT NULL,
  [templateSourceId] NVARCHAR(1000) NULL,
  [title] NVARCHAR(1000) NOT NULL,
  [ownerId] NVARCHAR(1000) NOT NULL,
  [amountCents] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanSource_amountCents_df] DEFAULT 0,
  [sortOrder] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanSource_sortOrder_df] DEFAULT 0,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetPlanSource_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [MonthlyBudgetPlanSource_pkey] PRIMARY KEY ([id])
);

CREATE INDEX [MonthlyBudgetPlanSource_planId_sortOrder_idx]
ON [dbo].[MonthlyBudgetPlanSource]([planId], [sortOrder]);

CREATE INDEX [MonthlyBudgetPlanSource_templateSourceId_idx]
ON [dbo].[MonthlyBudgetPlanSource]([templateSourceId]);

CREATE INDEX [MonthlyBudgetPlanSource_ownerId_idx]
ON [dbo].[MonthlyBudgetPlanSource]([ownerId]);

CREATE TABLE [dbo].[MonthlyBudgetPlanItem] (
  [id] NVARCHAR(1000) NOT NULL,
  [planId] NVARCHAR(1000) NOT NULL,
  [templateItemId] NVARCHAR(1000) NULL,
  [title] NVARCHAR(1000) NOT NULL,
  [amountCents] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_amountCents_df] DEFAULT 0,
  [destinationSubAccountId] NVARCHAR(1000) NULL,
  [sortOrder] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_sortOrder_df] DEFAULT 0,
  [appliedCents] INT NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_appliedCents_df] DEFAULT 0,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [MonthlyBudgetPlanItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [MonthlyBudgetPlanItem_pkey] PRIMARY KEY ([id])
);

CREATE INDEX [MonthlyBudgetPlanItem_planId_sortOrder_idx]
ON [dbo].[MonthlyBudgetPlanItem]([planId], [sortOrder]);

CREATE INDEX [MonthlyBudgetPlanItem_templateItemId_idx]
ON [dbo].[MonthlyBudgetPlanItem]([templateItemId]);

CREATE INDEX [MonthlyBudgetPlanItem_destinationSubAccountId_idx]
ON [dbo].[MonthlyBudgetPlanItem]([destinationSubAccountId]);

-- A plan inherits the strictest legacy state across both item and source rows.
WITH [LegacyPlanRows] AS (
  SELECT
    [workspaceId],
    [year],
    [month],
    [isDraft],
    [confirmedAt],
    [createdAt],
    [updatedAt]
  FROM [dbo].[MonthlyBudget]

  UNION ALL

  SELECT
    [workspaceId],
    [year],
    [month],
    [isDraft],
    [confirmedAt],
    [createdAt],
    [updatedAt]
  FROM [dbo].[MonthlyBudgetSource]
),
[LegacyPlanRollup] AS (
  SELECT
    [workspaceId],
    [year],
    [month],
    SUM(CASE WHEN [isDraft] = 1 THEN 1 ELSE 0 END) AS [draftCount],
    SUM(CASE WHEN [isDraft] = 0 THEN 1 ELSE 0 END) AS [confirmedCount],
    MAX([confirmedAt]) AS [confirmedAt],
    MIN([createdAt]) AS [createdAt],
    MAX([updatedAt]) AS [updatedAt]
  FROM [LegacyPlanRows]
  GROUP BY [workspaceId], [year], [month]
)
INSERT INTO [dbo].[MonthlyBudgetPlan] (
  [id],
  [workspaceId],
  [year],
  [month],
  [status],
  [confirmedAt],
  [createdAt],
  [updatedAt]
)
SELECT
  CONVERT(NVARCHAR(1000), NEWID()),
  [workspaceId],
  [year],
  [month],
  CASE
    WHEN [draftCount] > 0 AND [confirmedCount] > 0 THEN N'REVIEW'
    WHEN [draftCount] > 0 THEN N'DRAFT'
    ELSE N'CONFIRMED'
  END,
  CASE WHEN [confirmedCount] > 0 THEN [confirmedAt] ELSE NULL END,
  [createdAt],
  [updatedAt]
FROM [LegacyPlanRollup];

INSERT INTO [dbo].[MonthlyBudgetPlanSource] (
  [id],
  [planId],
  [templateSourceId],
  [title],
  [ownerId],
  [amountCents],
  [sortOrder],
  [createdAt],
  [updatedAt]
)
SELECT
  CONVERT(NVARCHAR(1000), NEWID()),
  [plan].[id],
  [source].[budgetSourceId],
  [source].[title],
  [source].[ownerId],
  [source].[amountCents],
  ROW_NUMBER() OVER (
    PARTITION BY [source].[workspaceId], [source].[year], [source].[month]
    ORDER BY [source].[createdAt], [source].[id]
  ) - 1,
  [source].[createdAt],
  [source].[updatedAt]
FROM [dbo].[MonthlyBudgetSource] AS [source]
INNER JOIN [dbo].[MonthlyBudgetPlan] AS [plan]
  ON [plan].[workspaceId] = [source].[workspaceId]
 AND [plan].[year] = [source].[year]
 AND [plan].[month] = [source].[month];

-- Collapse each legacy item/source matrix into one item. Applied cents are
-- recorded for idempotency; no ledger or budget-envelope rows are replayed.
WITH [LegacyItemRollup] AS (
  SELECT
    [MonthlyBudget].[workspaceId],
    [MonthlyBudget].[year],
    [MonthlyBudget].[month],
    [MonthlyBudget].[budgetItemId],
    COALESCE(MAX([MonthlyBudget].[budgetItemTitle]), MAX([budgetItem].[title]), N'Budget Item') AS [title],
    SUM([MonthlyBudget].[allocatedCents]) AS [amountCents],
    COALESCE(
      MAX([MonthlyBudget].[destinationSubAccountId]),
      MAX([budgetItem].[destinationSubAccountId])
    ) AS [destinationSubAccountId],
    SUM(CASE WHEN [MonthlyBudget].[appliedAt] IS NOT NULL THEN [MonthlyBudget].[allocatedCents] ELSE 0 END) AS [appliedCents],
    MIN([MonthlyBudget].[createdAt]) AS [createdAt],
    MAX([MonthlyBudget].[updatedAt]) AS [updatedAt],
    MIN([budgetItem].[sortOrder]) AS [templateSortOrder]
  FROM [dbo].[MonthlyBudget]
  LEFT JOIN [dbo].[BudgetItem] AS [budgetItem]
    ON [budgetItem].[id] = [MonthlyBudget].[budgetItemId]
  GROUP BY
    [MonthlyBudget].[workspaceId],
    [MonthlyBudget].[year],
    [MonthlyBudget].[month],
    [MonthlyBudget].[budgetItemId]
),
[OrderedLegacyItems] AS (
  SELECT
    [LegacyItemRollup].*,
    ROW_NUMBER() OVER (
      PARTITION BY [workspaceId], [year], [month]
      ORDER BY COALESCE([templateSortOrder], 2147483647), [createdAt], [budgetItemId]
    ) - 1 AS [sortOrder]
  FROM [LegacyItemRollup]
)
INSERT INTO [dbo].[MonthlyBudgetPlanItem] (
  [id],
  [planId],
  [templateItemId],
  [title],
  [amountCents],
  [destinationSubAccountId],
  [sortOrder],
  [appliedCents],
  [createdAt],
  [updatedAt]
)
SELECT
  CONVERT(NVARCHAR(1000), NEWID()),
  [plan].[id],
  [item].[budgetItemId],
  [item].[title],
  [item].[amountCents],
  [item].[destinationSubAccountId],
  [item].[sortOrder],
  [item].[appliedCents],
  [item].[createdAt],
  [item].[updatedAt]
FROM [OrderedLegacyItems] AS [item]
INNER JOIN [dbo].[MonthlyBudgetPlan] AS [plan]
  ON [plan].[workspaceId] = [item].[workspaceId]
 AND [plan].[year] = [item].[year]
 AND [plan].[month] = [item].[month];
