// lib/auth.ts
import jwt from "jsonwebtoken";

const SESSION_SECRET = process.env.SESSION_SECRET ?? (() => {
  throw new Error("SESSION_SECRET env var is not set");
})();

const SESSION_MAX_AGE_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS || "7");
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = "session" as const;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

export type SessionPayload = {
  userId: string;
};

export function createSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, SESSION_SECRET, {
    expiresIn: SESSION_MAX_AGE_SECONDS,
  });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SESSION_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}
