import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { test as setup } from "@playwright/test";
import { prisma } from "../../lib/prisma";

setup("create isolated browser session", async ({ context, baseURL }) => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || !baseURL) throw new Error("NEXTAUTH_SECRET and baseURL are required for browser setup");

  const user = await prisma.user.findUniqueOrThrow({ where: { email: "owner@nest.local" } });
  let secondary = await prisma.workspace.findFirst({ where: { name: "E2E Secondary" } });
  secondary ??= await prisma.workspace.create({
    data: { name: "E2E Secondary", baseCurrency: "SGD" },
  });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: secondary.id, userId: user.id } },
    create: { workspaceId: secondary.id, userId: user.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

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
    name: "next-auth.session-token",
    value: token,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    expires: Math.floor(now.getTime() / 1_000) + 60 * 60,
  }]);
  await context.storageState({ path: ".auth/user.json" });
});
