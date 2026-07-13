import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { getWebAuthnConfig, rememberWebAuthnChallenge } from "@/lib/passkeys";

export async function POST(request: Request) {
  const { rpID } = getWebAuthnConfig(request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const challenge = await rememberWebAuthnChallenge("AUTHENTICATION", options.challenge);
  return NextResponse.json({ challengeId: challenge.id, options });
}
