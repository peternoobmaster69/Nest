CREATE TABLE [dbo].[HotelRewardAccount] (
  [id] NVARCHAR(1000) NOT NULL,
  [workspaceId] NVARCHAR(1000) NOT NULL,
  [programName] NVARCHAR(1000) NOT NULL,
  [hotelBrand] NVARCHAR(1000) NOT NULL,
  [accountNumber] NVARCHAR(1000),
  [currentPoints] INT NOT NULL CONSTRAINT [HotelRewardAccount_currentPoints_df] DEFAULT 0,
  [targetPoints] INT,
  [centsPerPoint] FLOAT(53) NOT NULL CONSTRAINT [HotelRewardAccount_centsPerPoint_df] DEFAULT 0,
  [notes] NVARCHAR(1000),
  [isActive] BIT NOT NULL CONSTRAINT [HotelRewardAccount_isActive_df] DEFAULT 1,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [HotelRewardAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [HotelRewardAccount_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [HotelRewardAccount_workspaceId_programName_key]
ON [dbo].[HotelRewardAccount]([workspaceId], [programName]);

CREATE INDEX [HotelRewardAccount_workspaceId_isActive_idx]
ON [dbo].[HotelRewardAccount]([workspaceId], [isActive]);
