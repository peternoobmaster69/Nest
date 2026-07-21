import { PrismaClient } from "@prisma/client";
import { isDatabaseWakeTransientError } from "@/lib/database-errors";
import { resolveDatabaseUrl } from "@/lib/database-url";

const DATABASE_WAKE_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;
const DATABASE_READY_TTL_MS = 30_000;

type DatabaseReadinessGlobal = typeof globalThis & {
  databaseReadyAt?: number;
  databaseWakePromise?: Promise<void>;
};

type WaitForDatabaseOptions = {
  probe: () => Promise<void>;
  sleep?: (delayMs: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  isRetryable?: (error: unknown) => boolean;
};

const readinessGlobal = globalThis as DatabaseReadinessGlobal;

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForDatabaseReady({
  probe,
  sleep: wait = sleep,
  retryDelaysMs = DATABASE_WAKE_RETRY_DELAYS_MS,
  isRetryable = isDatabaseWakeTransientError,
}: WaitForDatabaseOptions) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await probe();
      return;
    } catch (error) {
      const retryDelay = retryDelaysMs[attempt];
      if (retryDelay === undefined || !isRetryable(error)) throw error;
      await wait(retryDelay);
    }
  }
}

async function probeDatabaseWithFreshConnection() {
  const wakeClient = new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
  });

  try {
    await wakeClient.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
  } finally {
    await wakeClient.$disconnect().catch(() => undefined);
  }
}

export async function ensureDatabaseReady() {
  if (
    readinessGlobal.databaseReadyAt &&
    Date.now() - readinessGlobal.databaseReadyAt < DATABASE_READY_TTL_MS
  ) {
    return;
  }

  if (!readinessGlobal.databaseWakePromise) {
    const wakePromise = waitForDatabaseReady({ probe: probeDatabaseWithFreshConnection })
      .then(() => {
        readinessGlobal.databaseReadyAt = Date.now();
      })
      .finally(() => {
        if (readinessGlobal.databaseWakePromise === wakePromise) {
          readinessGlobal.databaseWakePromise = undefined;
        }
      });
    readinessGlobal.databaseWakePromise = wakePromise;
  }

  await readinessGlobal.databaseWakePromise;
}
