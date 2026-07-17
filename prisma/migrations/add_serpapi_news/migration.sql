CREATE TABLE [dbo].[SerpApiNewsCache] (
    [cacheKey] NVARCHAR(450) NOT NULL,
    [payloadJson] NVARCHAR(MAX) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL CONSTRAINT [SerpApiNewsCache_fetchedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [SerpApiNewsCache_pkey] PRIMARY KEY CLUSTERED ([cacheKey])
);

CREATE INDEX [SerpApiNewsCache_expiresAt_idx]
ON [dbo].[SerpApiNewsCache]([expiresAt]);

CREATE TABLE [dbo].[SerpApiQuota] (
    [provider] NVARCHAR(100) NOT NULL,
    [windowKey] NVARCHAR(32) NOT NULL,
    [requestCount] INT NOT NULL CONSTRAINT [SerpApiQuota_requestCount_df] DEFAULT 0,
    [nextAllowedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [SerpApiQuota_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SerpApiQuota_pkey] PRIMARY KEY CLUSTERED ([provider])
);
