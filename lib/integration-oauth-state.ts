import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export async function createIntegrationOAuthState(userId: string, workspaceId: string) {
  const state = randomBytes(32).toString("base64url");
  await prisma.integrationOAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.integrationOAuthState.create({
    data: {
      tokenHash: hashState(state),
      userId,
      workspaceId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  return state;
}

export async function consumeIntegrationOAuthState(state: string) {
  const tokenHash = hashState(state);
  return prisma.$transaction(async (tx) => {
    const record = await tx.integrationOAuthState.findUnique({ where: { tokenHash } });
    if (!record || record.expiresAt <= new Date()) return null;
    const claimed = await tx.integrationOAuthState.deleteMany({ where: { tokenHash } });
    return claimed.count === 1 ? record : null;
  });
}
