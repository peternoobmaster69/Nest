CREATE TABLE [dbo].[InAppNotification] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [workspaceId] NVARCHAR(1000),
    [type] NVARCHAR(1000) NOT NULL,
    [dedupeKey] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [message] NVARCHAR(MAX) NOT NULL,
    [href] NVARCHAR(1000),
    [metadataJson] NVARCHAR(MAX),
    [readAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InAppNotification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [InAppNotification_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InAppNotification_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [InAppNotification_userId_dedupeKey_key] UNIQUE NONCLUSTERED ([userId], [dedupeKey])
);

CREATE INDEX [InAppNotification_userId_workspaceId_readAt_updatedAt_idx]
ON [dbo].[InAppNotification]([userId], [workspaceId], [readAt], [updatedAt]);

CREATE INDEX [InAppNotification_workspaceId_type_idx]
ON [dbo].[InAppNotification]([workspaceId], [type]);
