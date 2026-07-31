import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

export function isDiagnosticsAuthorized(request: Request) {
  const expected = process.env.HEALTHCHECK_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function collectReadinessDiagnostics() {
  const startedAt = performance.now();
  await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
  const now = new Date();
  const [runningExpired, pendingOldest, deadLetters] = await Promise.all([
    prisma.backgroundJob.count({ where: { status: "RUNNING", leaseExpiresAt: { lt: now } } }),
    prisma.backgroundJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { availableAt: "asc" },
      select: { availableAt: true },
    }),
    prisma.backgroundJob.count({ where: { status: "DEAD_LETTER" } }),
  ]);
  return {
    database: { status: "ready", latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 },
    jobs: {
      status: runningExpired === 0 ? "ready" : "degraded",
      expiredLeases: runningExpired,
      deadLetters,
      oldestQueueAgeSeconds: pendingOldest
        ? Math.max(0, Math.round((now.getTime() - pendingOldest.availableAt.getTime()) / 1_000))
        : 0,
    },
  };
}
