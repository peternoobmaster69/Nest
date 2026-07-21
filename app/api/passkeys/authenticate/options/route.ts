import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { NextResponse } from "next/server";
import { getWebAuthnConfig, rememberWebAuthnChallenge } from "@/lib/passkeys";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export async function POST(request: Request) {
  try {
    await enforceDistributedRateLimit(request, {
      scope: "passkey-auth-options",
      limit: 20,
      windowMs: 5 * 60 * 1000,
    });
    const { rpID } = getWebAuthnConfig(request);
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    const challenge = await rememberWebAuthnChallenge("AUTHENTICATION", options.challenge);
    return NextResponse.json({ challengeId: challenge.id, options });
  } catch (error) {
    return rateLimitResponse(error) ?? NextResponse.json({ error: "Unable to start passkey authentication" }, { status: 503 });
  }
}
