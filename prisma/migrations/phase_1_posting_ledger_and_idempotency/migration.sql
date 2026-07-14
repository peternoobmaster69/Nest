CREATE TABLE [PostingGroup] (
  [id] NVARCHAR(191) NOT NULL,
  [workspaceId] NVARCHAR(191) NOT NULL,
  [operation] NVARCHAR(120) NOT NULL,
  [sourceType] NVARCHAR(80) NULL,
  [sourceId] NVARCHAR(191) NULL,
  [actorUserId] NVARCHAR(191) NULL,
  [idempotencyKey] NVARCHAR(191) NOT NULL,
  [status] NVARCHAR(40) NOT NULL CONSTRAINT [PostingGroup_status_df] DEFAULT 'POSTED',
  [reversalOfId] NVARCHAR(191) NULL,
  [reason] NVARCHAR(500) NULL,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [PostingGroup_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [reversedAt] DATETIME2 NULL,
  CONSTRAINT [PostingGroup_pkey] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [PostingGroup_workspace_operation_key_key] UNIQUE ([workspaceId], [operation], [idempotencyKey])
);

CREATE INDEX [PostingGroup_workspace_source_idx] ON [PostingGroup]([workspaceId], [sourceType], [sourceId]);
CREATE INDEX [PostingGroup_reversalOfId_idx] ON [PostingGroup]([reversalOfId]);

CREATE TABLE [IdempotencyRecord] (
  [id] NVARCHAR(191) NOT NULL,
  [workspaceId] NVARCHAR(191) NOT NULL,
  [operation] NVARCHAR(120) NOT NULL,
  [idempotencyKey] NVARCHAR(191) NOT NULL,
  [requestHash] NVARCHAR(64) NOT NULL,
  [status] NVARCHAR(40) NOT NULL CONSTRAINT [IdempotencyRecord_status_df] DEFAULT 'IN_PROGRESS',
  [postingGroupId] NVARCHAR(191) NULL,
  [resultJson] NVARCHAR(MAX) NULL,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [IdempotencyRecord_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [completedAt] DATETIME2 NULL,
  CONSTRAINT [IdempotencyRecord_pkey] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [IdempotencyRecord_workspace_operation_key_key] UNIQUE ([workspaceId], [operation], [idempotencyKey])
);

CREATE INDEX [IdempotencyRecord_workspace_createdAt_idx] ON [IdempotencyRecord]([workspaceId], [createdAt]);

ALTER TABLE [Transaction] ADD
  [postingGroupId] NVARCHAR(191) NULL,
  [creditCardTransactionId] NVARCHAR(191) NULL,
  [receivableId] NVARCHAR(191) NULL,
  [reversalOfId] NVARCHAR(191) NULL,
  [voidedAt] DATETIME2 NULL,
  [voidedByUserId] NVARCHAR(191) NULL,
  [voidReason] NVARCHAR(500) NULL;

EXEC('CREATE INDEX [Transaction_postingGroupId_idx] ON [Transaction]([postingGroupId])');
EXEC('CREATE INDEX [Transaction_creditCardTransactionId_idx] ON [Transaction]([creditCardTransactionId])');
EXEC('CREATE INDEX [Transaction_receivableId_idx] ON [Transaction]([receivableId])');
EXEC('CREATE INDEX [Transaction_reversalOfId_idx] ON [Transaction]([reversalOfId])');

ALTER TABLE [CreditCardTxnLink] ADD [creditCardTransactionId] NVARCHAR(191) NULL;
EXEC('CREATE INDEX [CreditCardTxnLink_creditCardTransactionId_idx] ON [CreditCardTxnLink]([creditCardTransactionId])');

-- Safely backfill links created by auto-accounting, whose external reference embeds
-- the source credit-card transaction ID. Older manual links remain NULL rather than
-- guessing and potentially associating another card transaction.
EXEC('UPDATE link
SET link.[creditCardTransactionId] = sourceTxn.[id]
FROM [CreditCardTxnLink] AS link
INNER JOIN [Transaction] AS ledgerTxn ON ledgerTxn.[id] = link.[transactionId]
INNER JOIN [CreditCardTransaction] AS sourceTxn
  ON sourceTxn.[creditCardId] = link.[creditCardId]
 AND ledgerTxn.[externalRef] LIKE CONCAT(''credit-auto:'', sourceTxn.[id], '':%'')');

EXEC('CREATE UNIQUE INDEX [CreditCardTxnLink_creditCardTransactionId_unique]
ON [CreditCardTxnLink]([creditCardTransactionId])
WHERE [creditCardTransactionId] IS NOT NULL');

ALTER TABLE [Receivable] ADD [postingGroupId] NVARCHAR(191) NULL;
EXEC('CREATE INDEX [Receivable_postingGroupId_idx] ON [Receivable]([postingGroupId])');
