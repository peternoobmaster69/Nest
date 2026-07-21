import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { claimWebAuthnChallenge, getWebAuthnConfig } from "@/lib/passkeys";
import { ApiAuthError, requireRecentAuthentication } from "@/lib/workspace-auth";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireRecentAuthentication();
    await enforceDistributedRateLimit(request, {
      scope: "passkey-register-verify",
      identifier: userId,
      limit: 10,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { challengeId?: string; name?: string; response?: RegistrationResponseJSON };
  if (!body.challengeId || !body.response) return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  const passkeyName = body.name?.trim().replace(/\s+/g, " ");
  if (!passkeyName || passkeyName.length > 80) {
    return NextResponse.json({ error: "Passkey name must be between 1 and 80 characters" }, { status: 400 });
  }
  const challenge = await claimWebAuthnChallenge(body.challengeId, "REGISTRATION", userId);
  if (!challenge) return NextResponse.json({ error: "Passkey challenge expired" }, { status: 400 });
  const { origin, rpID } = getWebAuthnConfig(request);
  try {
    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verification.verified) return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
    const info = verification.registrationInfo;
    await prisma.passkeyCredential.create({
      data: {
        userId,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: passkeyName,
      },
    });
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
  }
}
