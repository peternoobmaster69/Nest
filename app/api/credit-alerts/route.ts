import { ingestCreditAlert } from "@/lib/credit-alert-ingest";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const IngestAlertSchema = z.object({
  rawBody: z.string().min(20),
  rawSubject: z.string().max(255).optional(),
});

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const staged = await prisma.cardAlertStaging.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        source: true,
        bankName: true,
        transactionRef: true,
        currency: true,
        amountCents: true,
        transactionDate: true,
        merchant: true,
        cardLast4: true,
        parseStatus: true,
        failureReason: true,
        creditCardId: true,
        creditTransactionId: true,
        createdAt: true,
        processedAt: true,
      },
    });
    return NextResponse.json(staged);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch alert staging", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const parsed = IngestAlertSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await ingestCreditAlert({
      workspaceId,
      rawBody: parsed.data.rawBody,
      rawSubject: parsed.data.rawSubject,
      source: "EMAIL",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to ingest alert", message }, { status: 500 });
  }
}
