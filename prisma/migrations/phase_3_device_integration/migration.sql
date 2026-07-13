CREATE TABLE [dbo].[PasskeyCredential] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [credentialId] NVARCHAR(1000) NOT NULL,
    [publicKey] VARBINARY(MAX) NOT NULL,
    [counter] BIGINT NOT NULL CONSTRAINT [PasskeyCredential_counter_df] DEFAULT 0,
    [transports] NVARCHAR(1000),
    [deviceType] NVARCHAR(1000) NOT NULL,
    [backedUp] BIT NOT NULL CONSTRAINT [PasskeyCredential_backedUp_df] DEFAULT 0,
    [name] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PasskeyCredential_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastUsedAt] DATETIME2,
    CONSTRAINT [PasskeyCredential_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PasskeyCredential_credentialId_key] UNIQUE NONCLUSTERED ([credentialId])
);

CREATE INDEX [PasskeyCredential_userId_createdAt_idx]
ON [dbo].[PasskeyCredential]([userId], [createdAt]);

ALTER TABLE [dbo].[PasskeyCredential]
ADD CONSTRAINT [PasskeyCredential_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE [dbo].[WebAuthnChallenge] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [purpose] NVARCHAR(1000) NOT NULL,
    [challenge] NVARCHAR(1000) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [WebAuthnChallenge_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [WebAuthnChallenge_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [WebAuthnChallenge_challenge_key] UNIQUE NONCLUSTERED ([challenge])
);

CREATE INDEX [WebAuthnChallenge_userId_purpose_expiresAt_idx]
ON [dbo].[WebAuthnChallenge]([userId], [purpose], [expiresAt]);

CREATE INDEX [WebAuthnChallenge_purpose_expiresAt_idx]
ON [dbo].[WebAuthnChallenge]([purpose], [expiresAt]);

ALTER TABLE [dbo].[WebAuthnChallenge]
ADD CONSTRAINT [WebAuthnChallenge_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE [dbo].[PushSubscription] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [endpoint] NVARCHAR(1000) NOT NULL,
    [p256dh] NVARCHAR(1000) NOT NULL,
    [auth] NVARCHAR(1000) NOT NULL,
    [expirationTime] BIGINT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PushSubscription_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [PushSubscription_updatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PushSubscription_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PushSubscription_endpoint_key] UNIQUE NONCLUSTERED ([endpoint])
);

CREATE INDEX [PushSubscription_userId_updatedAt_idx]
ON [dbo].[PushSubscription]([userId], [updatedAt]);

ALTER TABLE [dbo].[PushSubscription]
ADD CONSTRAINT [PushSubscription_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
