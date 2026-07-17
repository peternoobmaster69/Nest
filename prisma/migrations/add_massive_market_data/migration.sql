CREATE TABLE [dbo].[MassiveMarketDataCache] (
    [cacheKey] NVARCHAR(450) NOT NULL,
    [payloadJson] NVARCHAR(MAX) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL CONSTRAINT [MassiveMarketDataCache_fetchedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [MassiveMarketDataCache_pkey] PRIMARY KEY CLUSTERED ([cacheKey])
);

CREATE INDEX [MassiveMarketDataCache_expiresAt_idx]
ON [dbo].[MassiveMarketDataCache]([expiresAt]);

CREATE TABLE [dbo].[MassiveApiThrottle] (
    [provider] NVARCHAR(100) NOT NULL,
    [nextAllowedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [MassiveApiThrottle_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MassiveApiThrottle_pkey] PRIMARY KEY CLUSTERED ([provider])
);
