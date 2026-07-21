import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { consumePasskeyLoginTicket } from "@/lib/passkeys";
import { ensureUserWithDefaultWorkspace } from "@/lib/workspace-bootstrap";

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
  session: { strategy: "jwt" },
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
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.authenticatedAt = Math.floor(Date.now() / 1000);
        const storedUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { sessionVersion: true },
        });
        token.sessionVersion = storedUser?.sessionVersion ?? 0;
        token.revoked = false;
      } else if (token.id) {
        const storedUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { sessionVersion: true },
        });
        token.revoked = !storedUser || storedUser.sessionVersion !== token.sessionVersion;
      }
      return token;
    },
    async session({ session, token, user }) {
      if (session.user && !token.revoked) {
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
  },
  pages: {
    signIn: "/signin",
  },
};

const handler = NextAuth(authOptions);

export { handler };
