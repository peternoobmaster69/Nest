ALTER TABLE [dbo].[CardAlertStaging] DROP CONSTRAINT [CardAlertStaging_creditTransactionId_key];

CREATE NONCLUSTERED INDEX [CardAlertStaging_creditTransactionId_idx]
ON [dbo].[CardAlertStaging]([creditTransactionId]);
