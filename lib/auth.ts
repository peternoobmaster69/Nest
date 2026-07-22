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
import {
  ACTIVE_SESSION_RENEWAL_WINDOW_MS,
  AUTH_SESSION_MAX_AGE_SECONDS,
  getActiveSessionExpiry,
} from "@/lib/session-policy";
import { ensureUserWithDefaultWorkspace } from "@/lib/workspace-bootstrap";

async function claimSessionIfAvailable({
  userId,
  sessionId,
  sessionVersion,
  now,
}: {
  userId: string;
  sessionId: string;
  sessionVersion: number;
  now: Date;
}) {
  const claimed = await prisma.user.updateMany({
    where: {
      id: userId,
      sessionVersion,
      OR: [
        { activeSessionId: null },
        { activeSessionExpiresAt: null },
        { activeSessionExpiresAt: { lte: now } },
      ],
    },
    data: {
      activeSessionId: sessionId,
      activeSessionExpiresAt: getActiveSessionExpiry(now),
      lastSignedInAt: now,
    },
  });
  return claimed.count === 1;
}

async function initializeSessionToken(
  token: JWT,
  userId: string,
  login?: { provider: string | null },
) {
  const now = new Date();
  const storedUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      sessionVersion: true,
    },
  });

  token.id = userId;
  token.sessionId = randomUUID();
  token.authenticatedAt ??= Math.floor(now.getTime() / 1000);
  token.sessionVersion = storedUser?.sessionVersion ?? 0;
  token.revoked = !storedUser;
  token.takeoverRequired = false;

  if (!storedUser) return token;

  if (login) {
    const requestMetadata = getAuthRequestMetadata();
    await prisma.loginSession.create({
      data: {
        sessionId: token.sessionId,
        userId,
        provider: login.provider,
        ipAddress: requestMetadata.ipAddress,
        countryCode: requestMetadata.countryCode,
        signedInAt: now,
      },
    });
  }

  const claimed = await claimSessionIfAvailable({
    userId,
    sessionId: token.sessionId,
    sessionVersion: storedUser.sessionVersion,
    now,
  });
  token.takeoverRequired = !claimed;
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
      const storedUser = await prisma.user.findUnique({
        where: { id: token.id },
        select: {
          sessionVersion: true,
          activeSessionId: true,
          activeSessionExpiresAt: true,
        },
      });
      if (!storedUser || storedUser.sessionVersion !== token.sessionVersion) {
        token.revoked = true;
        token.takeoverRequired = false;
        return token;
      }

      if (token.takeoverRequired) {
        if (storedUser.activeSessionId === token.sessionId) {
          token.takeoverRequired = false;
        } else if (
          !storedUser.activeSessionId ||
          !storedUser.activeSessionExpiresAt ||
          storedUser.activeSessionExpiresAt <= now
        ) {
          const claimed = await claimSessionIfAvailable({
            userId: token.id,
            sessionId: token.sessionId,
            sessionVersion: storedUser.sessionVersion,
            now,
          });
          token.takeoverRequired = !claimed;
        }
        token.revoked = false;
        return token;
      }

      token.revoked = storedUser.activeSessionId !== token.sessionId;
      if (
        !token.revoked &&
        (!storedUser.activeSessionExpiresAt ||
          storedUser.activeSessionExpiresAt.getTime() - now.getTime() <= ACTIVE_SESSION_RENEWAL_WINDOW_MS)
      ) {
        await prisma.user.updateMany({
          where: { id: token.id, activeSessionId: token.sessionId },
          data: { activeSessionExpiresAt: getActiveSessionExpiry(now) },
        });
      }
      return token;
    },
    async session({ session, token, user }) {
      session.takeoverRequired = Boolean(token.takeoverRequired && !token.revoked);
      if (session.user && !token.revoked && !token.takeoverRequired) {
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
      await prisma.user.updateMany({
        where: { id: token.id, activeSessionId: token.sessionId },
        data: { activeSessionId: null, activeSessionExpiresAt: null },
      });
    },
  },
  pages: {
    signIn: "/login",
  },
};

const handler = NextAuth(authOptions);

export { handler };
