import { createHash, randomBytes } from "node:crypto";
import { decryptCredential, encryptCredential, oauthVerifierContext } from "@/lib/credential-encryption";
import { prisma } from "@/lib/prisma";

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export async function createIntegrationOAuthState(userId: string, workspaceId: string) {
  const state = randomBytes(32).toString("base64url");
  const tokenHash = hashState(state);
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  await prisma.integrationOAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.integrationOAuthState.create({
    data: {
      tokenHash,
      userId,
      workspaceId,
      pkceVerifier: encryptCredential(codeVerifier, oauthVerifierContext(tokenHash)),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  return { state, codeChallenge };
}

export async function consumeIntegrationOAuthState(state: string) {
  const tokenHash = hashState(state);
  return prisma.$transaction(async (tx) => {
    const record = await tx.integrationOAuthState.findUnique({ where: { tokenHash } });
    if (!record || record.expiresAt <= new Date()) return null;
    const claimed = await tx.integrationOAuthState.deleteMany({ where: { tokenHash } });
    if (claimed.count !== 1) return null;
    return {
      userId: record.userId,
      workspaceId: record.workspaceId,
      codeVerifier: decryptCredential(record.pkceVerifier, oauthVerifierContext(tokenHash)),
    };
  });
}
