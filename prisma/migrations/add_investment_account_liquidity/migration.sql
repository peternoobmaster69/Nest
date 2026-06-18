ALTER TABLE [dbo].[InvestmentAccount]
ADD [isLiquid] BIT NOT NULL CONSTRAINT [InvestmentAccount_isLiquid_df] DEFAULT 0;
