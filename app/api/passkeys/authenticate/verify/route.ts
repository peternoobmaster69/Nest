import type { AuthenticationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  consumeWebAuthnChallenge,
  createPasskeyLoginTicket,
  getWebAuthnConfig,
  parseTransports,
  readWebAuthnChallenge,
} from "@/lib/passkeys";

export async function POST(request: Request) {
  const body = await request.json() as { challengeId?: string; response?: AuthenticationResponseJSON };
  if (!body.challengeId || !body.response) return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  const challenge = await readWebAuthnChallenge(body.challengeId, "AUTHENTICATION");
  if (!challenge) return NextResponse.json({ error: "Passkey challenge expired" }, { status: 400 });
  const passkey = await prisma.passkeyCredential.findUnique({ where: { credentialId: body.response.id } });
  if (!passkey) return NextResponse.json({ error: "Passkey not recognized" }, { status: 401 });
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey verification failed";
    return NextResponse.json({ error: message }, { status: 401 });
  } finally {
    await consumeWebAuthnChallenge(challenge.id);
  }
}
