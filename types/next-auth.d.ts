import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    sessionLimitRequired?: boolean;
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
    sessionLimitRequired?: boolean;
    revoked?: boolean;
  }
}
