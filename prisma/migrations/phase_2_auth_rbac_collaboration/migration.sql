ALTER TABLE [User] ADD [sessionVersion] INT NOT NULL CONSTRAINT [User_sessionVersion_df] DEFAULT 0;

UPDATE [WorkspaceMember] SET [role] = 'EDITOR' WHERE [role] = 'MEMBER';
DECLARE @WorkspaceMemberRoleDefault NVARCHAR(128);
SELECT @WorkspaceMemberRoleDefault = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.default_object_id = dc.object_id
WHERE dc.parent_object_id = OBJECT_ID(N'[WorkspaceMember]') AND c.name = N'role';
IF @WorkspaceMemberRoleDefault IS NOT NULL
  EXEC(N'ALTER TABLE [WorkspaceMember] DROP CONSTRAINT [' + @WorkspaceMemberRoleDefault + N']');
ALTER TABLE [WorkspaceMember] ADD CONSTRAINT [WorkspaceMember_role_df] DEFAULT 'VIEWER' FOR [role];

ALTER TABLE [WorkspaceInvite] ADD
  [role] NVARCHAR(1000) NOT NULL CONSTRAINT [WorkspaceInvite_role_df] DEFAULT 'VIEWER',
  [tokenHash] VARCHAR(64),
  [expiresAt] DATETIME2,
  [revokedAt] DATETIME2;
-- Defer compilation until the preceding ALTER TABLE has added tokenHash.
EXEC('CREATE INDEX [WorkspaceInvite_tokenHash_idx] ON [WorkspaceInvite]([tokenHash])');
EXEC('CREATE UNIQUE INDEX [WorkspaceInvite_tokenHash_unique]
  ON [WorkspaceInvite]([tokenHash]) WHERE [tokenHash] IS NOT NULL');

CREATE TABLE [SecurityRateLimit] (
  [keyHash] VARCHAR(64) NOT NULL,
  [count] INT NOT NULL CONSTRAINT [SecurityRateLimit_count_df] DEFAULT 0,
  [windowStartedAt] DATETIME2 NOT NULL,
  [blockedUntil] DATETIME2,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [SecurityRateLimit_pkey] PRIMARY KEY CLUSTERED ([keyHash])
);
CREATE INDEX [SecurityRateLimit_updatedAt_idx] ON [SecurityRateLimit]([updatedAt]);

CREATE TABLE [IntegrationOAuthState] (
  [tokenHash] VARCHAR(64) NOT NULL,
  [userId] NVARCHAR(1000) NOT NULL,
  [workspaceId] NVARCHAR(1000) NOT NULL,
  [expiresAt] DATETIME2 NOT NULL,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [IntegrationOAuthState_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT [IntegrationOAuthState_pkey] PRIMARY KEY CLUSTERED ([tokenHash])
);
CREATE INDEX [IntegrationOAuthState_expiresAt_idx] ON [IntegrationOAuthState]([expiresAt]);
