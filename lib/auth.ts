import { randomUUID } from "node:crypto";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import AppleProvider from "next-auth/providers/apple";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getAuthRequestMetadata } from "@/lib/auth-request-metadata";
import { prisma } from "@/lib/prisma";
import { consumePasskeyLoginTicket } from "@/lib/passkeys";
import { describeSessionDevice } from "@/lib/session-device";
import {
  ACTIVE_SESSION_RENEWAL_WINDOW_MS,
  ACTIVE_SESSION_TOUCH_INTERVAL_MS,
  AUTH_SESSION_MAX_AGE_SECONDS,
  getActiveSessionExpiry,
  getPendingSessionExpiry,
  MAX_ACTIVE_SESSIONS,
} from "@/lib/session-policy";
import { ensureUserWithDefaultWorkspace } from "@/lib/workspace-bootstrap";

async function initializeSessionToken(
  token: JWT,
  userId: string,
  login?: { provider: string | null },
) {
  const now = new Date();
  const sessionId = randomUUID();
  token.id = userId;
  token.sessionId = sessionId;
  token.authenticatedAt ??= Math.floor(now.getTime() / 1000);
  token.revoked = false;
  token.sessionLimitRequired = false;

  const requestMetadata = getAuthRequestMetadata();
  const result = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT [id] FROM [dbo].[User] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${userId}
    `;
    const storedUser = await transaction.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    if (!storedUser) return null;

    await transaction.loginSession.updateMany({
      where: {
        userId,
        status: { in: ["ACTIVE", "PENDING"] },
        expiresAt: { lte: now },
      },
      data: { status: "REVOKED", revokedAt: now },
    });
    const activeSessionCount = await transaction.loginSession.count({
      where: { userId, status: "ACTIVE", expiresAt: { gt: now } },
    });
    const status = activeSessionCount < MAX_ACTIVE_SESSIONS ? "ACTIVE" : "PENDING";

    await transaction.loginSession.create({
      data: {
        sessionId,
        userId,
        provider: login?.provider ?? null,
        deviceName: describeSessionDevice(requestMetadata.userAgent),
        ipAddress: requestMetadata.ipAddress,
        countryCode: requestMetadata.countryCode,
        status,
        signedInAt: now,
        lastSeenAt: now,
        expiresAt: status === "ACTIVE" ? getActiveSessionExpiry(now) : getPendingSessionExpiry(now),
      },
    });
    if (login) {
      await transaction.user.update({ where: { id: userId }, data: { lastSignedInAt: now } });
    }
    return { sessionVersion: storedUser.sessionVersion, status };
  });

  token.sessionVersion = result?.sessionVersion ?? 0;
  token.revoked = !result;
  token.sessionLimitRequired = result?.status === "PENDING";
  return token;
}

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    id: "passkey",
    name: "Passkey",
    credentials: {
      loginToken: { label: "Passkey login token", type: "text" },
    },
    async authorize(credentials) {
      if (!credentials?.loginToken) return null;
      const user = await consumePasskeyLoginTicket(credentials.loginToken);
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  providers.push(
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    }),
  );
}

if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
  providers.push(
    FacebookProvider({
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    }),
  );
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: AUTH_SESSION_MAX_AGE_SECONDS },
  providers,
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || account.type !== "oauth") return true;
      const claims = (profile ?? {}) as Record<string, unknown>;
      return (
        claims.email_verified === true ||
        claims.email_verified === "true" ||
        claims.verified === true
      );
    },
    async jwt({ token, user, account }) {
      if (user?.id) {
        token.authenticatedAt = Math.floor(Date.now() / 1000);
        return initializeSessionToken(token, user.id, { provider: account?.provider ?? null });
      }

      if (!token.id) return token;
      if (!token.sessionId) return initializeSessionToken(token, token.id);

      const now = new Date();
      const [storedUser, storedSession] = await Promise.all([
        prisma.user.findUnique({
          where: { id: token.id },
          select: { sessionVersion: true },
        }),
        prisma.loginSession.findUnique({
          where: { sessionId: token.sessionId },
          select: { userId: true, status: true, expiresAt: true, lastSeenAt: true },
        }),
      ]);
      if (
        !storedUser ||
        storedUser.sessionVersion !== token.sessionVersion ||
        !storedSession ||
        storedSession.userId !== token.id
      ) {
        token.revoked = true;
        token.sessionLimitRequired = false;
        return token;
      }

      if (storedSession.expiresAt <= now || storedSession.status === "REVOKED") {
        token.revoked = true;
        token.sessionLimitRequired = false;
        if (storedSession.status !== "REVOKED") {
          await prisma.loginSession.updateMany({
            where: { sessionId: token.sessionId, status: storedSession.status },
            data: { status: "REVOKED", revokedAt: now },
          });
        }
        return token;
      }

      if (storedSession.status === "PENDING") {
        token.revoked = false;
        token.sessionLimitRequired = true;
        return token;
      }

      token.revoked = storedSession.status !== "ACTIVE";
      token.sessionLimitRequired = false;
      if (
        !token.revoked &&
        (storedSession.expiresAt.getTime() - now.getTime() <= ACTIVE_SESSION_RENEWAL_WINDOW_MS ||
          now.getTime() - storedSession.lastSeenAt.getTime() >= ACTIVE_SESSION_TOUCH_INTERVAL_MS)
      ) {
        await prisma.loginSession.updateMany({
          where: { sessionId: token.sessionId, userId: token.id, status: "ACTIVE" },
          data: { lastSeenAt: now, expiresAt: getActiveSessionExpiry(now) },
        });
      }
      return token;
    },
    async session({ session, token, user }) {
      session.sessionLimitRequired = Boolean(token.sessionLimitRequired && !token.revoked);
      if (session.user && !token.revoked && !token.sessionLimitRequired) {
        session.user.id = token.id || token.sub || user?.id || "";
        session.user.authenticatedAt = token.authenticatedAt ?? 0;
      } else {
        session.user = undefined;
      }
      return session;
    },
  },
  events: {
    async linkAccount({ user, account }) {
      await prisma.account.updateMany({
        where: {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          userId: user.id,
        },
        data: {
          access_token: null,
          refresh_token: null,
          id_token: null,
          session_state: null,
        },
      });
      const memberships = await prisma.workspaceMember.findMany({
        where: { userId: user.id },
        select: { workspaceId: true },
      });
      if (memberships.length) {
        await prisma.workspaceAuditLog.createMany({
          data: memberships.map((membership) => ({
            workspaceId: membership.workspaceId,
            actorUserId: user.id,
            action: "AUTH_ACCOUNT_LINKED",
            details: `${account.provider} sign-in linked after provider verification.`,
          })),
        });
      }
    },
    async signIn({ user, account }) {
      if (!user.id) return;
      if (account?.type === "oauth" && user.email) {
        await prisma.user.updateMany({
          where: { id: user.id, emailVerified: null },
          data: { emailVerified: new Date() },
        });
      }
      await ensureUserWithDefaultWorkspace({
        id: user.id,
        email: user.email,
        name: user.name,
      });
    },
    async signOut({ token }) {
      if (!token.id || !token.sessionId) return;
      await prisma.loginSession.updateMany({
        where: { userId: token.id, sessionId: token.sessionId, status: { in: ["ACTIVE", "PENDING"] } },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    },
  },
  pages: {
    signIn: "/login",
  },
};

const handler = NextAuth(authOptions);

export { handler };
