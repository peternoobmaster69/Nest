-- AlterTable
ALTER TABLE [dbo].[Receivable] ADD [budgetId] NVARCHAR(1000) NULL;

-- AddForeignKey
ALTER TABLE [dbo].[Receivable] ADD CONSTRAINT [Receivable_budgetId_fkey] FOREIGN KEY ([budgetId]) REFERENCES [dbo].[BudgetEnvelope]([id]) ON DELETE SET NULL ON UPDATE CASCADE;
