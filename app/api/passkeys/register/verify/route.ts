import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeWebAuthnChallenge, getWebAuthnConfig, readWebAuthnChallenge } from "@/lib/passkeys";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { challengeId?: string; name?: string; response?: RegistrationResponseJSON };
  if (!body.challengeId || !body.response) return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  const challenge = await readWebAuthnChallenge(body.challengeId, "REGISTRATION", session.user.id);
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
        userId: session.user.id,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        name: body.name?.trim().slice(0, 80) || "Passkey",
      },
    });
    return NextResponse.json({ verified: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    await consumeWebAuthnChallenge(challenge.id);
  }
}
