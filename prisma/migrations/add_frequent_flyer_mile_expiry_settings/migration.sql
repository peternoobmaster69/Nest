ALTER TABLE [dbo].[FrequentFlyerAccount]
ADD [mileNeverExpire] BIT NOT NULL CONSTRAINT [FrequentFlyerAccount_mileNeverExpire_df] DEFAULT 0,
    [validityPeriodYears] INT NOT NULL CONSTRAINT [FrequentFlyerAccount_validityPeriodYears_df] DEFAULT 3;
