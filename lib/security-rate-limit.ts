import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type RateLimitOptions = {
  scope: string;
  identifier?: string | null;
  limit: number;
  windowMs: number;
  blockMs?: number;
};

function requestAddress(request: Request) {
  const headers = request.headers;
  if (process.env.VERCEL) {
    return (headers.get("x-vercel-forwarded-for")?.split(",")[0] || "unknown").trim();
  }
  if (process.env.WEBSITE_SITE_NAME || process.env.WEBSITE_INSTANCE_ID) {
    return (headers.get("x-azure-clientip") || "unknown").trim();
  }
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    return (
      headers.get("cf-connecting-ip") ||
      headers.get("x-real-ip") ||
      headers.get("x-forwarded-for")?.split(",")[0] ||
      "unknown"
    ).trim();
  }
  return "unknown";
}

export async function enforceDistributedRateLimit(request: Request, options: RateLimitOptions) {
  const rawKey = `${options.scope}:${requestAddress(request)}:${options.identifier ?? ""}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const now = new Date();
  const cutoff = new Date(now.getTime() - options.windowMs);
  const blockMs = options.blockMs ?? options.windowMs;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const current = await tx.securityRateLimit.findUnique({ where: { keyHash } });
          if (current?.blockedUntil && current.blockedUntil > now) return current.blockedUntil;

          if (!current || current.windowStartedAt <= cutoff) {
            await tx.securityRateLimit.upsert({
              where: { keyHash },
              create: { keyHash, count: 1, windowStartedAt: now },
              update: { count: 1, windowStartedAt: now, blockedUntil: null },
            });
            return null;
          }

          const updated = await tx.securityRateLimit.update({
            where: { keyHash },
            data: { count: { increment: 1 } },
          });
          if (updated.count <= options.limit) return null;

          const blockedUntil = new Date(now.getTime() + blockMs);
          await tx.securityRateLimit.update({ where: { keyHash }, data: { blockedUntil } });
          return blockedUntil;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (result) {
        const retryAfter = Math.max(1, Math.ceil((result.getTime() - now.getTime()) / 1000));
        const error = new Error("Too many requests") as Error & { retryAfter: number };
        error.retryAfter = retryAfter;
        throw error;
      }
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
}

export function rateLimitResponse(error: unknown) {
  const retryAfter =
    error instanceof Error && "retryAfter" in error
      ? Number((error as Error & { retryAfter: number }).retryAfter)
      : null;
  if (!retryAfter) return null;
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
