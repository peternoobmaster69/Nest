import { ingestCreditAlert } from "@/lib/credit-alert-ingest";
import { ensureActiveGmailAccessToken, fetchGmailMessage, listGmailMessageIds } from "@/lib/gmail";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { workspaceId, userId } = await requireWorkspaceAccess();
    const origin = new URL(request.url).origin;
    const integration = await prisma.gmailIntegration.findFirst({
      where: { workspaceId, userId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!integration) {
      return NextResponse.json({ error: "Gmail is not connected." }, { status: 400 });
    }

    const accessToken = await ensureActiveGmailAccessToken(integration.id, origin);
    const ids = await listGmailMessageIds(
      accessToken,
      `newer_than:30d (subject:"Card Transaction Alert" OR from:unialerts@uobgroup.com OR subject:"Your transaction has been reversed" OR from:noreply@notify.ocbc.com OR from:alerts@citibank.com.sg OR subject:"Citi Alerts - Credit Card/Ready Credit Transaction")`,
    );

    let processed = 0;
    let duplicates = 0;
    let failed = 0;

    for (const msg of ids) {
      const full = await fetchGmailMessage(accessToken, msg.id);
      const result = await ingestCreditAlert({
        workspaceId,
        rawBody: full.body,
        rawSubject: full.subject,
        source: "GMAIL",
      });
      if ("duplicate" in result && result.duplicate) {
        duplicates += 1;
      } else if ("parseStatus" in result && result.parseStatus === "PROCESSED") {
        processed += 1;
      } else if ("parseStatus" in result && result.parseStatus === "DUPLICATE") {
        duplicates += 1;
      } else {
        failed += 1;
      }
    }

    await prisma.gmailIntegration.update({
      where: { id: integration.id },
      data: { lastSyncedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      scannedMessages: ids.length,
      processed,
      duplicates,
      failed,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to sync Gmail", message }, { status: 500 });
  }
}
