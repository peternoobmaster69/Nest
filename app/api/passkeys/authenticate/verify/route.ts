import type { AuthenticationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  claimWebAuthnChallenge,
  createPasskeyLoginTicket,
  getWebAuthnConfig,
  parseTransports,
} from "@/lib/passkeys";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { challengeId?: string; response?: AuthenticationResponseJSON };
  if (!body.challengeId || !body.response) return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  try {
    await enforceDistributedRateLimit(request, {
      scope: "passkey-auth-verify",
      identifier: body.response.id,
      limit: 10,
      windowMs: 5 * 60 * 1000,
      blockMs: 15 * 60 * 1000,
    });
  } catch (error) {
    return rateLimitResponse(error) ?? NextResponse.json({ error: "Unable to verify passkey" }, { status: 503 });
  }
  const challenge = await claimWebAuthnChallenge(body.challengeId, "AUTHENTICATION");
  if (!challenge) return NextResponse.json({ error: "Passkey challenge expired" }, { status: 400 });
  const passkey = await prisma.passkeyCredential.findUnique({ where: { credentialId: body.response.id } });
  if (!passkey) return NextResponse.json({ error: "Passkey verification failed" }, { status: 401 });
  const { origin, rpID } = getWebAuthnConfig(request);
  const credential: WebAuthnCredential = {
    id: passkey.credentialId,
    publicKey: new Uint8Array(passkey.publicKey),
    counter: Number(passkey.counter),
    transports: parseTransports(passkey.transports),
  };
  try {
    const verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
    if (!verification.verified) return NextResponse.json({ error: "Passkey verification failed" }, { status: 401 });
    await prisma.passkeyCredential.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: new Date(),
      },
    });
    const loginToken = await createPasskeyLoginTicket(passkey.userId);
    return NextResponse.json({ verified: true, loginToken });
  } catch {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 401 });
  }
}
