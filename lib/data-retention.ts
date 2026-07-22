import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_POLICY = 20;

type PolicyName =
  | "oauthStates"
  | "webAuthnChallenges"
  | "jobPayloads"
  | "backgroundJobs"
  | "cardAlertBodies"
  | "workspaceInvites"
  | "notifications"
  | "auditLogs"
  | "loginSessions"
  | "expiredCaches"
  | "rateLimits";

type RetentionPolicy = {
  env: string;
  defaultDays: number;
  minimumDays: number;
  maximumDays: number;
};

const POLICIES = {
  jobPayloads: { env: "BACKGROUND_JOB_PAYLOAD_RETENTION_DAYS", defaultDays: 14, minimumDays: 1, maximumDays: 365 },
  backgroundJobs: { env: "BACKGROUND_JOB_RETENTION_DAYS", defaultDays: 90, minimumDays: 7, maximumDays: 3_650 },
  cardAlertBodies: { env: "CARD_ALERT_BODY_RETENTION_DAYS", defaultDays: 7, minimumDays: 1, maximumDays: 365 },
  workspaceInvites: { env: "INVITE_RETENTION_DAYS", defaultDays: 30, minimumDays: 1, maximumDays: 365 },
  readNotifications: { env: "READ_NOTIFICATION_RETENTION_DAYS", defaultDays: 90, minimumDays: 7, maximumDays: 3_650 },
  notifications: { env: "NOTIFICATION_RETENTION_DAYS", defaultDays: 365, minimumDays: 30, maximumDays: 3_650 },
  auditLogs: { env: "AUDIT_LOG_RETENTION_DAYS", defaultDays: 730, minimumDays: 90, maximumDays: 7_300 },
  loginSessions: { env: "LOGIN_SESSION_RETENTION_DAYS", defaultDays: 90, minimumDays: 7, maximumDays: 730 },
} satisfies Record<string, RetentionPolicy>;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = value?.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function retentionDays(policy: RetentionPolicy) {
  return boundedInteger(process.env[policy.env], policy.defaultDays, policy.minimumDays, policy.maximumDays);
}

export function getDataRetentionConfig() {
  return {
    batchSize: boundedInteger(process.env.DATA_RETENTION_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    jobPayloadDays: retentionDays(POLICIES.jobPayloads),
    backgroundJobDays: retentionDays(POLICIES.backgroundJobs),
    cardAlertBodyDays: retentionDays(POLICIES.cardAlertBodies),
    inviteDays: retentionDays(POLICIES.workspaceInvites),
    readNotificationDays: retentionDays(POLICIES.readNotifications),
    notificationDays: retentionDays(POLICIES.notifications),
    auditLogDays: retentionDays(POLICIES.auditLogs),
    loginSessionDays: retentionDays(POLICIES.loginSessions),
  };
}

function cutoff(now: Date, days: number) {
  return new Date(now.getTime() - days * DAY_MS);
}

async function runBoundedPolicy(action: (batchSize: number) => Promise<number>, batchSize: number) {
  let affected = 0;
  let batches = 0;
  let hasMore = false;

  while (batches < MAX_BATCHES_PER_POLICY) {
    const count = await action(batchSize);
    affected += count;
    if (!count) {
      hasMore = false;
      break;
    }
    batches += 1;
    hasMore = count === batchSize;
    if (!hasMore) break;
  }

  return { affected, batches, hasMore };
}

export async function runDataRetention(options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const config = getDataRetentionConfig();
  const results = {} as Record<PolicyName, { affected: number; batches: number; hasMore: boolean }>;

  results.oauthStates = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`DELETE TOP (${size}) FROM [dbo].[IntegrationOAuthState] WHERE [expiresAt] < ${now}`),
    config.batchSize,
  );
  results.webAuthnChallenges = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`DELETE TOP (${size}) FROM [dbo].[WebAuthnChallenge] WHERE [expiresAt] < ${now}`),
    config.batchSize,
  );

  const jobPayloadCutoff = cutoff(now, config.jobPayloadDays);
  results.jobPayloads = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      UPDATE TOP (${size}) [dbo].[BackgroundJob]
      SET [payloadJson] = NULL, [checkpointJson] = NULL, [resultJson] = NULL, [error] = NULL
      WHERE [finishedAt] < ${jobPayloadCutoff}
        AND ([payloadJson] IS NOT NULL OR [checkpointJson] IS NOT NULL OR [resultJson] IS NOT NULL OR [error] IS NOT NULL)
    `),
    config.batchSize,
  );

  const backgroundJobCutoff = cutoff(now, config.backgroundJobDays);
  results.backgroundJobs = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      DELETE TOP (${size}) FROM [dbo].[BackgroundJob]
      WHERE [status] IN (N'SUCCEEDED', N'SKIPPED', N'FAILED', N'DEAD_LETTER', N'CANCELLED')
        AND [finishedAt] < ${backgroundJobCutoff}
    `),
    config.batchSize,
  );

  const cardAlertCutoff = cutoff(now, config.cardAlertBodyDays);
  results.cardAlertBodies = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      UPDATE TOP (${size}) [dbo].[CardAlertStaging]
      SET [rawBody] = N'[REDACTED]', [rawSubject] = NULL
      WHERE [createdAt] < ${cardAlertCutoff} AND [rawBody] <> N'[REDACTED]'
    `),
    config.batchSize,
  );

  const inviteCutoff = cutoff(now, config.inviteDays);
  results.workspaceInvites = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      DELETE TOP (${size}) FROM [dbo].[WorkspaceInvite]
      WHERE [expiresAt] < ${inviteCutoff}
         OR ([status] <> N'PENDING' AND [respondedAt] < ${inviteCutoff})
    `),
    config.batchSize,
  );

  const readNotificationCutoff = cutoff(now, config.readNotificationDays);
  const notificationCutoff = cutoff(now, config.notificationDays);
  results.notifications = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      DELETE TOP (${size}) FROM [dbo].[InAppNotification]
      WHERE [readAt] < ${readNotificationCutoff} OR [createdAt] < ${notificationCutoff}
    `),
    config.batchSize,
  );

  const auditCutoff = cutoff(now, config.auditLogDays);
  results.auditLogs = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`DELETE TOP (${size}) FROM [dbo].[WorkspaceAuditLog] WHERE [createdAt] < ${auditCutoff}`),
    config.batchSize,
  );

  const loginSessionCutoff = cutoff(now, config.loginSessionDays);
  results.loginSessions = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      DELETE TOP (${size}) FROM [dbo].[LoginSession] WHERE [signedInAt] < ${loginSessionCutoff}
    `),
    config.batchSize,
  );

  results.expiredCaches = await runBoundedPolicy(async (size) => {
    const market = await prisma.$executeRaw(Prisma.sql`DELETE TOP (${size}) FROM [dbo].[MassiveMarketDataCache] WHERE [expiresAt] < ${now}`);
    const news = await prisma.$executeRaw(Prisma.sql`DELETE TOP (${size}) FROM [dbo].[SerpApiNewsCache] WHERE [expiresAt] < ${now}`);
    return market + news;
  }, config.batchSize);

  const rateLimitCutoff = cutoff(now, 7);
  results.rateLimits = await runBoundedPolicy(
    (size) => prisma.$executeRaw(Prisma.sql`
      DELETE TOP (${size}) FROM [dbo].[SecurityRateLimit]
      WHERE [updatedAt] < ${rateLimitCutoff} AND ([blockedUntil] IS NULL OR [blockedUntil] < ${now})
    `),
    config.batchSize,
  );

  return { now, config, policies: results };
}
