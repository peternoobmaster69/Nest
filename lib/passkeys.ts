import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 60 * 1000;

export type WebAuthnPurpose = "REGISTRATION" | "AUTHENTICATION" | "LOGIN_TICKET";

export function getWebAuthnConfig(request: Request) {
  const requestUrl = new URL(request.url);
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN || process.env.NEXTAUTH_URL;
  const origin = (configuredOrigin || requestUrl.origin).replace(/\/$/, "");
  return {
    rpName: process.env.WEBAUTHN_RP_NAME || "Nest",
    rpID: process.env.WEBAUTHN_RP_ID || new URL(origin).hostname,
    origin,
  };
}

export async function rememberWebAuthnChallenge(
  purpose: Exclude<WebAuthnPurpose, "LOGIN_TICKET">,
  challenge: string,
  userId?: string,
) {
  await prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return prisma.webAuthnChallenge.create({
    data: {
      purpose,
      challenge,
      userId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

export async function readWebAuthnChallenge(id: string, purpose: WebAuthnPurpose, userId?: string) {
  const challenge = await prisma.webAuthnChallenge.findFirst({
    where: {
      id,
      purpose,
      ...(userId ? { userId } : {}),
      expiresAt: { gt: new Date() },
    },
  });
  return challenge;
}

export async function consumeWebAuthnChallenge(id: string) {
  await prisma.webAuthnChallenge.delete({ where: { id } }).catch(() => undefined);
}

function hashLoginTicket(ticket: string) {
  return createHash("sha256").update(ticket).digest("base64url");
}

export async function createPasskeyLoginTicket(userId: string) {
  const ticket = randomBytes(32).toString("base64url");
  await prisma.webAuthnChallenge.create({
    data: {
      purpose: "LOGIN_TICKET",
      challenge: hashLoginTicket(ticket),
      userId,
      expiresAt: new Date(Date.now() + LOGIN_TICKET_TTL_MS),
    },
  });
  return ticket;
}

export async function consumePasskeyLoginTicket(ticket: string) {
  const challengeHash = hashLoginTicket(ticket);
  return prisma.$transaction(async (tx) => {
    const record = await tx.webAuthnChallenge.findUnique({
      where: { challenge: challengeHash },
      include: { user: true },
    });
    if (!record || record.purpose !== "LOGIN_TICKET" || !record.user || record.expiresAt <= new Date()) {
      return null;
    }
    await tx.webAuthnChallenge.delete({ where: { id: record.id } });
    return record.user;
  });
}

export function parseTransports(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as AuthenticatorTransport[];
  } catch {
    return undefined;
  }
}
