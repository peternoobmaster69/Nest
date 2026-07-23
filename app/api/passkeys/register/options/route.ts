import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWebAuthnConfig, parseTransports, rememberWebAuthnChallenge } from "@/lib/passkeys";
import { ApiAuthError, requireRecentAuthentication } from "@/lib/workspace-auth";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export async function POST(request: Request) {
  try {
    const userId = await requireRecentAuthentication();
    await enforceDistributedRateLimit(request, {
      scope: "passkey-register-options",
      identifier: userId,
      limit: 10,
      windowMs: 10 * 60_000,
    });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const existing = await prisma.passkeyCredential.findMany({ where: { userId: user.id }, take: 100 });
    const { rpID, rpName } = getWebAuthnConfig(request);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: isoUint8Array.fromUTF8String(user.id),
      userName: user.email || user.name || user.id,
      userDisplayName: user.name || user.email || "Nest user",
      attestationType: "none",
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: parseTransports(passkey.transports),
      })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: [-7, -257],
    });
    const challenge = await rememberWebAuthnChallenge("REGISTRATION", options.challenge, user.id);
    return NextResponse.json({ challengeId: challenge.id, options });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to start passkey registration" }, { status: 500 });
  }
}
