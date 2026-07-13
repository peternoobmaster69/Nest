import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWebAuthnConfig, parseTransports, rememberWebAuthnChallenge } from "@/lib/passkeys";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const existing = await prisma.passkeyCredential.findMany({ where: { userId: user.id } });
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
}
