BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AiAgentConfig] (
    [id] VARCHAR(64) NOT NULL,
    [enabled] BIT NOT NULL CONSTRAINT [AiAgentConfig_enabled_df] DEFAULT 1,
    [instructions] NVARCHAR(max) NOT NULL,
    [deployment] NVARCHAR(200),
    [reasoningEffort] VARCHAR(16) NOT NULL CONSTRAINT [AiAgentConfig_reasoningEffort_df] DEFAULT 'default',
    [maxOutputTokens] INT NOT NULL CONSTRAINT [AiAgentConfig_maxOutputTokens_df] DEFAULT 4000,
    [maxToolRounds] INT NOT NULL CONSTRAINT [AiAgentConfig_maxToolRounds_df] DEFAULT 8,
    [maxToolCalls] INT NOT NULL CONSTRAINT [AiAgentConfig_maxToolCalls_df] DEFAULT 16,
    [trainingExampleLimit] INT NOT NULL CONSTRAINT [AiAgentConfig_trainingExampleLimit_df] DEFAULT 4,
    [capabilitiesJson] NVARCHAR(max) NOT NULL,
    [revision] INT NOT NULL CONSTRAINT [AiAgentConfig_revision_df] DEFAULT 1,
    [updatedByUserId] NVARCHAR(191),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiAgentConfig_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiAgentConfig_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AiAgentRevision] (
    [id] NVARCHAR(191) NOT NULL,
    [agentId] VARCHAR(64) NOT NULL,
    [revision] INT NOT NULL,
    [settingsJson] NVARCHAR(max) NOT NULL,
    [actorUserId] NVARCHAR(191) NOT NULL,
    [action] VARCHAR(32) NOT NULL CONSTRAINT [AiAgentRevision_action_df] DEFAULT 'CONFIGURATION',
    [targetId] NVARCHAR(191),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiAgentRevision_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AiAgentRevision_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AiAgentRevision_agentId_revision_key] UNIQUE NONCLUSTERED ([agentId],[revision])
);

-- CreateTable
CREATE TABLE [dbo].[AiAgentExample] (
    [id] NVARCHAR(191) NOT NULL,
    [agentId] VARCHAR(64) NOT NULL,
    [title] NVARCHAR(120) NOT NULL,
    [input] NVARCHAR(max) NOT NULL,
    [expectedOutput] NVARCHAR(max) NOT NULL,
    [contextJson] NVARCHAR(max) NOT NULL,
    [contentHash] VARCHAR(64) NOT NULL,
    [purpose] VARCHAR(16) NOT NULL,
    [status] VARCHAR(16) NOT NULL CONSTRAINT [AiAgentExample_status_df] DEFAULT 'DRAFT',
    [matchMode] VARCHAR(16) NOT NULL,
    [revision] INT NOT NULL CONSTRAINT [AiAgentExample_revision_df] DEFAULT 1,
    [updatedByUserId] NVARCHAR(191) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiAgentExample_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiAgentExample_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AiAgentExample_agentId_contentHash_key] UNIQUE NONCLUSTERED ([agentId],[contentHash])
);

-- CreateTable
CREATE TABLE [dbo].[AiAgentEvaluation] (
    [id] NVARCHAR(191) NOT NULL,
    [agentId] VARCHAR(64) NOT NULL,
    [revision] INT NOT NULL,
    [datasetHash] VARCHAR(64) NOT NULL,
    [requestHash] VARCHAR(64) NOT NULL,
    [status] VARCHAR(16) NOT NULL,
    [passedCount] INT NOT NULL CONSTRAINT [AiAgentEvaluation_passedCount_df] DEFAULT 0,
    [totalCount] INT NOT NULL,
    [resultsJson] NVARCHAR(max) NOT NULL,
    [actorUserId] NVARCHAR(191) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiAgentEvaluation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiAgentEvaluation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AiAgentFineTuneJob] (
    [id] NVARCHAR(191) NOT NULL,
    [agentId] VARCHAR(64) NOT NULL,
    [revision] INT NOT NULL,
    [requestHash] VARCHAR(64) NOT NULL,
    [datasetHash] VARCHAR(64) NOT NULL,
    [providerHash] VARCHAR(64) NOT NULL,
    [providerJobId] NVARCHAR(200),
    [trainingFileId] NVARCHAR(200),
    [validationFileId] NVARCHAR(200),
    [baseModel] NVARCHAR(200) NOT NULL,
    [trainingType] VARCHAR(32) NOT NULL,
    [status] VARCHAR(32) NOT NULL,
    [fineTunedModel] NVARCHAR(300),
    [trainingCount] INT NOT NULL,
    [validationCount] INT NOT NULL,
    [error] NVARCHAR(500),
    [actorUserId] NVARCHAR(191) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AiAgentFineTuneJob_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AiAgentFineTuneJob_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentRevision_actorUserId_idx] ON [dbo].[AiAgentRevision]([actorUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentExample_agentId_purpose_status_idx] ON [dbo].[AiAgentExample]([agentId], [purpose], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentExample_updatedByUserId_idx] ON [dbo].[AiAgentExample]([updatedByUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentEvaluation_agentId_createdAt_idx] ON [dbo].[AiAgentEvaluation]([agentId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentEvaluation_actorUserId_idx] ON [dbo].[AiAgentEvaluation]([actorUserId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentFineTuneJob_agentId_createdAt_idx] ON [dbo].[AiAgentFineTuneJob]([agentId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentFineTuneJob_providerJobId_idx] ON [dbo].[AiAgentFineTuneJob]([providerJobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AiAgentFineTuneJob_actorUserId_idx] ON [dbo].[AiAgentFineTuneJob]([actorUserId]);

-- Configuration limits are also enforced below the API boundary.
ALTER TABLE [dbo].[AiAgentConfig] ADD CONSTRAINT [AiAgentConfig_limits_check] CHECK (
    [maxOutputTokens] BETWEEN 512 AND 16000 AND [maxToolRounds] BETWEEN 1 AND 12
    AND [maxToolCalls] BETWEEN [maxToolRounds] AND 32 AND [trainingExampleLimit] BETWEEN 0 AND 8
    AND [revision] >= 1 AND [reasoningEffort] IN ('default', 'low', 'medium', 'high')
    AND ISJSON([capabilitiesJson]) = 1
);
ALTER TABLE [dbo].[AiAgentExample] ADD CONSTRAINT [AiAgentExample_state_check] CHECK (
    [purpose] IN ('TRAINING', 'EVALUATION') AND [status] IN ('DRAFT', 'APPROVED')
    AND [matchMode] IN ('CONTAINS', 'EXACT', 'JSON_SUBSET') AND [revision] >= 1 AND ISJSON([contextJson]) = 1
);
ALTER TABLE [dbo].[AiAgentRevision] ADD CONSTRAINT [AiAgentRevision_json_check] CHECK (ISJSON([settingsJson]) = 1 AND [revision] >= 1);
ALTER TABLE [dbo].[AiAgentEvaluation] ADD CONSTRAINT [AiAgentEvaluation_result_check] CHECK (
    ISJSON([resultsJson]) = 1 AND [totalCount] BETWEEN 1 AND 5 AND [passedCount] BETWEEN 0 AND [totalCount]
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
