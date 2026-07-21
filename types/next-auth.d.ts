import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    takeoverRequired?: boolean;
    user?: DefaultSession["user"] & {
      id: string;
      authenticatedAt: number;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    authenticatedAt?: number;
    sessionVersion?: number;
    sessionId?: string;
    takeoverRequired?: boolean;
    revoked?: boolean;
  }
}
