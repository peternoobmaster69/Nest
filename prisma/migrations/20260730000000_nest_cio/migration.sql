BEGIN TRY
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[CioHouseholdProfile] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [primaryBirthDate] DATETIME2 NULL,
    [primaryCurrentAge] INT NULL,
    [primaryAgeAsOfDate] DATETIME2 NULL,
    [partnerBirthDate] DATETIME2 NULL,
    [targetRetirementAge] INT NULL,
    [targetRetirementDate] DATETIME2 NULL,
    [targetMonthlyRetirementSpendingCents] INT NULL,
    [essentialMonthlySpendingCents] INT NULL,
    [minimumImmediateBankCashCents] INT NULL,
    [inflationRateBps] INT NULL,
    [bearReturnBps] INT NULL,
    [baseReturnBps] INT NULL,
    [bullReturnBps] INT NULL,
    [sustainableWithdrawalRateBps] INT NULL,
    [annualExternalContributionOverrideCents] INT NULL,
    [contributionGrowthRateBps] INT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioHouseholdProfile_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioHouseholdProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioHouseholdProfile_workspaceId_key] UNIQUE NONCLUSTERED ([workspaceId]),
    CONSTRAINT [CioHouseholdProfile_age_source_check] CHECK (
      ([primaryBirthDate] IS NULL OR [primaryCurrentAge] IS NULL) AND
      (([primaryCurrentAge] IS NULL AND [primaryAgeAsOfDate] IS NULL) OR
       ([primaryCurrentAge] IS NOT NULL AND [primaryAgeAsOfDate] IS NOT NULL)) AND
      ([primaryCurrentAge] IS NULL OR [primaryCurrentAge] BETWEEN 0 AND 120) AND
      ([targetRetirementAge] IS NULL OR [targetRetirementAge] BETWEEN 18 AND 120) AND
      ([targetRetirementAge] IS NULL OR [targetRetirementDate] IS NULL)
    ),
    CONSTRAINT [CioHouseholdProfile_money_check] CHECK (
      ([targetMonthlyRetirementSpendingCents] IS NULL OR [targetMonthlyRetirementSpendingCents] >= 0) AND
      ([essentialMonthlySpendingCents] IS NULL OR [essentialMonthlySpendingCents] >= 0) AND
      ([minimumImmediateBankCashCents] IS NULL OR [minimumImmediateBankCashCents] >= 0) AND
      ([annualExternalContributionOverrideCents] IS NULL OR [annualExternalContributionOverrideCents] >= 0)
    ),
    CONSTRAINT [CioHouseholdProfile_rate_check] CHECK (
      ([inflationRateBps] IS NULL OR [inflationRateBps] BETWEEN -9999 AND 100000) AND
      ([bearReturnBps] IS NULL OR [bearReturnBps] BETWEEN -10000 AND 100000) AND
      ([baseReturnBps] IS NULL OR [baseReturnBps] BETWEEN -10000 AND 100000) AND
      ([bullReturnBps] IS NULL OR [bullReturnBps] BETWEEN -10000 AND 100000) AND
      ([contributionGrowthRateBps] IS NULL OR [contributionGrowthRateBps] BETWEEN -10000 AND 100000) AND
      ([sustainableWithdrawalRateBps] IS NULL OR [sustainableWithdrawalRateBps] BETWEEN 1 AND 10000) AND
      ([bearReturnBps] IS NULL OR [baseReturnBps] IS NULL OR [bearReturnBps] <= [baseReturnBps]) AND
      ([baseReturnBps] IS NULL OR [bullReturnBps] IS NULL OR [baseReturnBps] <= [bullReturnBps])
    )
  );

  CREATE TABLE [dbo].[CioInvestmentPolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [minimumLiquidityReserveCents] INT NULL,
    [minimumLiquidityMonths] INT NULL,
    [maximumAccountConcentrationBps] INT NULL,
    [maximumSingleSecurityConcentrationBps] INT NULL,
    [maximumSatelliteAllocationBps] INT NULL,
    [valuationStaleAfterDays] INT NOT NULL CONSTRAINT [CioInvestmentPolicy_valuationStaleAfterDays_df] DEFAULT 90,
    [allowsOptions] BIT NULL,
    [allowsMargin] BIT NULL,
    [allowsLeverage] BIT NULL,
    [allowsAdditionalIlpTopUps] BIT NULL,
    [confirmedAt] DATETIME2 NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioInvestmentPolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioInvestmentPolicy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioInvestmentPolicy_workspaceId_key] UNIQUE NONCLUSTERED ([workspaceId]),
    CONSTRAINT [CioInvestmentPolicy_bounds_check] CHECK (
      ([minimumLiquidityReserveCents] IS NULL OR [minimumLiquidityReserveCents] >= 0) AND
      ([minimumLiquidityMonths] IS NULL OR [minimumLiquidityMonths] BETWEEN 0 AND 120) AND
      ([maximumAccountConcentrationBps] IS NULL OR [maximumAccountConcentrationBps] BETWEEN 0 AND 10000) AND
      ([maximumSingleSecurityConcentrationBps] IS NULL OR [maximumSingleSecurityConcentrationBps] BETWEEN 0 AND 10000) AND
      ([maximumSatelliteAllocationBps] IS NULL OR [maximumSatelliteAllocationBps] BETWEEN 0 AND 10000) AND
      [valuationStaleAfterDays] BETWEEN 1 AND 3650
    )
  );

  CREATE TABLE [dbo].[CioPolicyAssetClassBand] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [assetClass] VARCHAR(32) NOT NULL,
    [minimumBps] INT NOT NULL,
    [targetBps] INT NOT NULL,
    [maximumBps] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioPolicyAssetClassBand_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioPolicyAssetClassBand_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioPolicyAssetClassBand_policyId_assetClass_key] UNIQUE NONCLUSTERED ([policyId], [assetClass]),
    CONSTRAINT [CioPolicyAssetClassBand_asset_class_check] CHECK ([assetClass] IN ('CASH','FIXED_INCOME','EQUITY','REIT','COMMODITY','PROPERTY','ALTERNATIVE','UNKNOWN')),
    CONSTRAINT [CioPolicyAssetClassBand_band_check] CHECK (0 <= [minimumBps] AND [minimumBps] <= [targetBps] AND [targetBps] <= [maximumBps] AND [maximumBps] <= 10000)
  );

  CREATE TABLE [dbo].[CioPolicyGeographyLimit] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [geography] VARCHAR(32) NOT NULL,
    [maximumBps] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioPolicyGeographyLimit_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioPolicyGeographyLimit_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioPolicyGeographyLimit_policyId_geography_key] UNIQUE NONCLUSTERED ([policyId], [geography]),
    CONSTRAINT [CioPolicyGeographyLimit_geography_check] CHECK ([geography] IN ('SINGAPORE','UNITED_STATES','CHINA','DEVELOPED_EX_US','EMERGING_EX_CHINA','GLOBAL','UNKNOWN')),
    CONSTRAINT [CioPolicyGeographyLimit_maximum_check] CHECK ([maximumBps] BETWEEN 0 AND 10000)
  );

  CREATE TABLE [dbo].[CioInvestmentProfile] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [investmentAccountId] NVARCHAR(1000) NOT NULL,
    [liquidityClass] VARCHAR(24) NOT NULL,
    [portfolioRole] VARCHAR(24) NOT NULL,
    [riskLevel] VARCHAR(24) NOT NULL,
    [includeInRetirementProjection] BIT NOT NULL CONSTRAINT [CioInvestmentProfile_includeRetirement_df] DEFAULT 0,
    [lockUntil] DATETIME2 NULL,
    [classificationStatus] VARCHAR(24) NOT NULL,
    [classificationSource] VARCHAR(32) NOT NULL,
    [notes] NVARCHAR(1000) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioInvestmentProfile_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioInvestmentProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioInvestmentProfile_investmentAccountId_key] UNIQUE NONCLUSTERED ([investmentAccountId]),
    CONSTRAINT [CioInvestmentProfile_workspace_account_key] UNIQUE NONCLUSTERED ([workspaceId], [investmentAccountId]),
    CONSTRAINT [CioInvestmentProfile_liquidity_check] CHECK ([liquidityClass] IN ('IMMEDIATE','LIQUID','RESTRICTED','LOCKED')),
    CONSTRAINT [CioInvestmentProfile_role_check] CHECK ([portfolioRole] IN ('EMERGENCY','CORE','STABILIZER','SATELLITE','GOAL','OTHER')),
    CONSTRAINT [CioInvestmentProfile_risk_check] CHECK ([riskLevel] IN ('LOW','MODERATE','HIGH','VERY_HIGH','UNKNOWN')),
    CONSTRAINT [CioInvestmentProfile_classification_check] CHECK ([classificationStatus] IN ('UNCLASSIFIED','SUGGESTED','USER_CONFIRMED')),
    CONSTRAINT [CioInvestmentProfile_lock_check] CHECK ([liquidityClass] = 'LOCKED' OR [lockUntil] IS NULL)
  );

  CREATE TABLE [dbo].[CioInvestmentExposure] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [investmentAccountId] NVARCHAR(1000) NOT NULL,
    [dimension] VARCHAR(24) NOT NULL,
    [exposureKey] VARCHAR(64) NOT NULL,
    [weightBps] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioInvestmentExposure_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioInvestmentExposure_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioInvestmentExposure_account_dimension_key] UNIQUE NONCLUSTERED ([investmentAccountId], [dimension], [exposureKey]),
    CONSTRAINT [CioInvestmentExposure_dimension_check] CHECK ([dimension] IN ('ASSET_CLASS','GEOGRAPHY','SECURITY')),
    CONSTRAINT [CioInvestmentExposure_weight_check] CHECK ([weightBps] BETWEEN 1 AND 10000),
    CONSTRAINT [CioInvestmentExposure_key_check] CHECK (LEN([exposureKey]) BETWEEN 1 AND 64)
  );

  CREATE TABLE [dbo].[CioPlanningPosition] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [side] VARCHAR(16) NOT NULL,
    [category] VARCHAR(48) NOT NULL,
    [label] NVARCHAR(160) NOT NULL,
    [currentValueCents] INT NOT NULL,
    [asOfDate] DATETIME2 NOT NULL,
    [liquidityClass] VARCHAR(24) NOT NULL,
    [includeInInvestableAllocation] BIT NOT NULL CONSTRAINT [CioPlanningPosition_includeInvestable_df] DEFAULT 0,
    [includeInRetirementProjection] BIT NOT NULL CONSTRAINT [CioPlanningPosition_includeRetirement_df] DEFAULT 0,
    [notes] NVARCHAR(1000) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioPlanningPosition_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioPlanningPosition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioPlanningPosition_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId], [id]),
    CONSTRAINT [CioPlanningPosition_side_check] CHECK ([side] IN ('ASSET','LIABILITY')),
    CONSTRAINT [CioPlanningPosition_liquidity_check] CHECK ([liquidityClass] IN ('IMMEDIATE','LIQUID','RESTRICTED','LOCKED')),
    CONSTRAINT [CioPlanningPosition_value_check] CHECK ([currentValueCents] >= 0),
    CONSTRAINT [CioPlanningPosition_liability_flags_check] CHECK ([side] = 'ASSET' OR ([includeInInvestableAllocation] = 0 AND [includeInRetirementProjection] = 0))
  );

  CREATE TABLE [dbo].[CioRecurringFlow] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [type] VARCHAR(32) NOT NULL,
    [sourceFinancialAccountId] NVARCHAR(1000) NULL,
    [sourceInvestmentAccountId] NVARCHAR(1000) NULL,
    [destinationInvestmentAccountId] NVARCHAR(1000) NULL,
    [amountCents] INT NOT NULL,
    [cadence] VARCHAR(16) NOT NULL,
    [startsOn] DATETIME2 NOT NULL,
    [endsOn] DATETIME2 NULL,
    [includeInRetirementProjection] BIT NOT NULL CONSTRAINT [CioRecurringFlow_includeRetirement_df] DEFAULT 0,
    [label] NVARCHAR(160) NOT NULL,
    [notes] NVARCHAR(1000) NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CioRecurringFlow_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CioRecurringFlow_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CioRecurringFlow_workspaceId_id_key] UNIQUE NONCLUSTERED ([workspaceId], [id]),
    CONSTRAINT [CioRecurringFlow_type_check] CHECK ([type] IN ('EXTERNAL_CONTRIBUTION','INTERNAL_REALLOCATION','EXTERNAL_WITHDRAWAL')),
    CONSTRAINT [CioRecurringFlow_cadence_check] CHECK ([cadence] IN ('WEEKLY','MONTHLY','QUARTERLY','ANNUAL')),
    CONSTRAINT [CioRecurringFlow_value_check] CHECK ([amountCents] > 0),
    CONSTRAINT [CioRecurringFlow_dates_check] CHECK ([endsOn] IS NULL OR [endsOn] >= [startsOn]),
    CONSTRAINT [CioRecurringFlow_source_check] CHECK (
      ([sourceFinancialAccountId] IS NULL OR [sourceInvestmentAccountId] IS NULL) AND
      ([sourceInvestmentAccountId] IS NULL OR [destinationInvestmentAccountId] IS NULL OR [sourceInvestmentAccountId] <> [destinationInvestmentAccountId])
    )
  );

  CREATE NONCLUSTERED INDEX [CioHouseholdProfile_workspaceId_updatedAt_idx] ON [dbo].[CioHouseholdProfile]([workspaceId], [updatedAt]);
  CREATE NONCLUSTERED INDEX [CioInvestmentPolicy_workspaceId_updatedAt_idx] ON [dbo].[CioInvestmentPolicy]([workspaceId], [updatedAt]);
  CREATE UNIQUE NONCLUSTERED INDEX [CioInvestmentPolicy_workspaceId_id_key] ON [dbo].[CioInvestmentPolicy]([workspaceId], [id]);
  CREATE NONCLUSTERED INDEX [CioPolicyAssetClassBand_workspaceId_assetClass_idx] ON [dbo].[CioPolicyAssetClassBand]([workspaceId], [assetClass]);
  CREATE NONCLUSTERED INDEX [CioPolicyGeographyLimit_workspaceId_geography_idx] ON [dbo].[CioPolicyGeographyLimit]([workspaceId], [geography]);
  CREATE NONCLUSTERED INDEX [CioInvestmentProfile_workspaceId_updatedAt_idx] ON [dbo].[CioInvestmentProfile]([workspaceId], [updatedAt]);
  CREATE NONCLUSTERED INDEX [CioInvestmentExposure_workspaceId_investmentAccountId_idx] ON [dbo].[CioInvestmentExposure]([workspaceId], [investmentAccountId]);
  CREATE NONCLUSTERED INDEX [CioInvestmentExposure_workspaceId_dimension_exposureKey_idx] ON [dbo].[CioInvestmentExposure]([workspaceId], [dimension], [exposureKey]);
  CREATE NONCLUSTERED INDEX [CioPlanningPosition_workspaceId_asOfDate_idx] ON [dbo].[CioPlanningPosition]([workspaceId], [asOfDate]);
  CREATE NONCLUSTERED INDEX [CioPlanningPosition_workspaceId_side_category_idx] ON [dbo].[CioPlanningPosition]([workspaceId], [side], [category]);
  CREATE NONCLUSTERED INDEX [CioRecurringFlow_workspaceId_startsOn_endsOn_idx] ON [dbo].[CioRecurringFlow]([workspaceId], [startsOn], [endsOn]);
  CREATE NONCLUSTERED INDEX [CioRecurringFlow_workspaceId_type_cadence_idx] ON [dbo].[CioRecurringFlow]([workspaceId], [type], [cadence]);
  CREATE NONCLUSTERED INDEX [CioRecurringFlow_sourceFinancialAccountId_idx] ON [dbo].[CioRecurringFlow]([sourceFinancialAccountId]);
  CREATE NONCLUSTERED INDEX [CioRecurringFlow_sourceInvestmentAccountId_idx] ON [dbo].[CioRecurringFlow]([sourceInvestmentAccountId]);
  CREATE NONCLUSTERED INDEX [CioRecurringFlow_destinationInvestmentAccountId_idx] ON [dbo].[CioRecurringFlow]([destinationInvestmentAccountId]);

  -- InvestmentAccount pre-dates the Phase 4 composite-key hardening list. Its
  -- Prisma @@unique is not emitted while relationMode is `prisma`, so add the
  -- physical candidate key required by the workspace-consistent CIO keys.
  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[InvestmentAccount]')
      AND [name] = N'InvestmentAccount_workspaceId_id_key'
  )
    CREATE UNIQUE NONCLUSTERED INDEX [InvestmentAccount_workspaceId_id_key]
      ON [dbo].[InvestmentAccount]([workspaceId], [id]);

  -- Prisma's relationMode is `prisma`, so application deletes retain the schema's
  -- Cascade/SetNull semantics. Physical NO ACTION keys reject orphaned and
  -- cross-workspace rows without creating SQL Server multiple-cascade paths.
  ALTER TABLE [dbo].[CioHouseholdProfile] WITH CHECK ADD CONSTRAINT [CioHouseholdProfile_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioInvestmentPolicy] WITH CHECK ADD CONSTRAINT [CioInvestmentPolicy_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioPolicyAssetClassBand] WITH CHECK ADD CONSTRAINT [CioPolicyAssetClassBand_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioPolicyAssetClassBand] WITH CHECK ADD CONSTRAINT [CioPolicyAssetClassBand_workspace_policy_fkey]
    FOREIGN KEY ([workspaceId], [policyId]) REFERENCES [dbo].[CioInvestmentPolicy]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioPolicyGeographyLimit] WITH CHECK ADD CONSTRAINT [CioPolicyGeographyLimit_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioPolicyGeographyLimit] WITH CHECK ADD CONSTRAINT [CioPolicyGeographyLimit_workspace_policy_fkey]
    FOREIGN KEY ([workspaceId], [policyId]) REFERENCES [dbo].[CioInvestmentPolicy]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioInvestmentProfile] WITH CHECK ADD CONSTRAINT [CioInvestmentProfile_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioInvestmentProfile] WITH CHECK ADD CONSTRAINT [CioInvestmentProfile_workspace_account_fkey]
    FOREIGN KEY ([workspaceId], [investmentAccountId]) REFERENCES [dbo].[InvestmentAccount]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioInvestmentExposure] WITH CHECK ADD CONSTRAINT [CioInvestmentExposure_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioInvestmentExposure] WITH CHECK ADD CONSTRAINT [CioInvestmentExposure_workspace_account_fkey]
    FOREIGN KEY ([workspaceId], [investmentAccountId]) REFERENCES [dbo].[InvestmentAccount]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioPlanningPosition] WITH CHECK ADD CONSTRAINT [CioPlanningPosition_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioRecurringFlow] WITH CHECK ADD CONSTRAINT [CioRecurringFlow_workspace_fkey]
    FOREIGN KEY ([workspaceId]) REFERENCES [dbo].[Workspace]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioRecurringFlow] WITH CHECK ADD CONSTRAINT [CioRecurringFlow_workspace_source_financial_fkey]
    FOREIGN KEY ([workspaceId], [sourceFinancialAccountId]) REFERENCES [dbo].[FinancialAccount]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioRecurringFlow] WITH CHECK ADD CONSTRAINT [CioRecurringFlow_workspace_source_investment_fkey]
    FOREIGN KEY ([workspaceId], [sourceInvestmentAccountId]) REFERENCES [dbo].[InvestmentAccount]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [dbo].[CioRecurringFlow] WITH CHECK ADD CONSTRAINT [CioRecurringFlow_workspace_destination_investment_fkey]
    FOREIGN KEY ([workspaceId], [destinationInvestmentAccountId]) REFERENCES [dbo].[InvestmentAccount]([workspaceId], [id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
