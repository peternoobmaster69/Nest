CREATE TABLE [dbo].[AskNestMemory] (
    [id] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [ownerHash] VARCHAR(64) NOT NULL,
    [keyHash] VARCHAR(64) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000) NOT NULL,
    [content] NVARCHAR(1000) NOT NULL,
    [sourceTurnId] NVARCHAR(1000),
    [confidence] FLOAT(53) NOT NULL CONSTRAINT [AskNestMemory_confidence_df] DEFAULT 1,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [AskNestMemory_status_df] DEFAULT 'ACTIVE',
    [lastConfirmedAt] DATETIME2,
    [expiresAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AskNestMemory_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [AskNestMemory_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AskNestMemory_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AskNestMemory_ownerHash_keyHash_key] UNIQUE NONCLUSTERED ([ownerHash], [keyHash])
);

CREATE INDEX [AskNestMemory_ownerHash_status_updatedAt_idx]
ON [dbo].[AskNestMemory]([ownerHash], [status], [updatedAt]);

CREATE INDEX [AskNestMemory_sourceTurnId_idx]
ON [dbo].[AskNestMemory]([sourceTurnId]);
