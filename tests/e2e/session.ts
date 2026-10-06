import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { test as base, type BrowserContext } from "@playwright/test";
import { prisma } from "../../lib/prisma";

export async function authenticateBrowserContext(context: BrowserContext, baseURL: string | undefined) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || !baseURL) throw new Error("NEXTAUTH_SECRET and baseURL are required for browser setup");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "owner@nest.local" } });
  const sessionId = randomUUID();
  const now = new Date();
  await prisma.loginSession.create({
    data: {
      sessionId,
      userId: user.id,
      provider: "phase9-e2e",
      deviceName: "Playwright",
      status: "ACTIVE",
      signedInAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    },
  });
  const token = await encode({
    secret,
    maxAge: 60 * 60,
    token: {
      id: user.id,
      sub: user.id,
      name: user.name,
      email: user.email,
      sessionId,
      sessionVersion: user.sessionVersion,
      authenticatedAt: Math.floor(now.getTime() / 1_000),
      revoked: false,
      sessionLimitRequired: false,
    },
  });
  const url = new URL(baseURL);
  await context.addCookies([{
    name: url.protocol === "https:" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    value: token,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: url.protocol === "https:",
    expires: Math.floor(now.getTime() / 1_000) + 60 * 60,
  }]);
  return sessionId;
}

export const test = base.extend({
  storageState: async ({ browser, baseURL }, provide) => {
    const context = await browser.newContext();
    const sessionId = await authenticateBrowserContext(context, baseURL);
    const state = await context.storageState();
    await context.close();
    try {
      await provide(state);
    } finally {
      await prisma.loginSession.updateMany({
        where: { sessionId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    }
  },
});
