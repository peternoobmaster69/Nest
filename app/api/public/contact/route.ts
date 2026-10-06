import { ApiRequestError, parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { getTrustedRequestMetadata } from "@/lib/auth-request-metadata";
import { ContactDeliveryUnavailableError, sendContactEmail } from "@/lib/contact-email";
import { ContactRequestSchema } from "@/lib/domains/contact/contracts";
import { logEvent } from "@/lib/observability/logger";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";

export const dynamic = "force-dynamic";

// Real people take longer than this to read the form and type a message.
const MIN_FILL_MS = 2500;

/** Public "Contact me" form on the landing page. Emails the ADMIN address; stores nothing. */
export async function POST(request: Request) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Unable to send your message" }, async ({ requestId }) => {
    // Per-IP limits: a short burst window and a daily cap.
    await enforceDistributedRateLimit(request, { scope: "public-contact-burst", limit: 3, windowMs: 10 * 60_000 });
    await enforceDistributedRateLimit(request, { scope: "public-contact-daily", limit: 10, windowMs: 24 * 60 * 60_000 });

    const input = await parseJsonBody(request, ContactRequestSchema, 16 * 1024);

    // Bots: pretend success so they get no signal to adapt to, but send nothing.
    if (input.website || (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS)) {
      logEvent("warn", "contact.discarded", { requestId, reason: input.website ? "honeypot" : "too_fast" });
      return Response.json({ ok: true }, { status: 202 });
    }

    // Per-sender cap so one address cannot flood the inbox from many IPs.
    await enforceDistributedRateLimit(request, {
      scope: "public-contact-sender",
      identifier: input.email.toLowerCase(),
      limit: 5,
      windowMs: 24 * 60 * 60_000,
    });

    try {
      await sendContactEmail({
        ...input,
        receivedAt: new Date(),
        ipCountry: getTrustedRequestMetadata(request).countryCode,
      });
    } catch (error) {
      if (error instanceof ContactDeliveryUnavailableError) {
        throw new ApiRequestError(503, "Messages can't be sent right now. Please try again later.");
      }
      throw error;
    }

    logEvent("info", "contact.sent", { requestId, topic: input.topic });
    return Response.json({ ok: true }, { status: 202 });
  });
}
