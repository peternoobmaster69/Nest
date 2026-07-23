import { ingestCreditAlert } from "@/lib/credit-alert-ingest";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { listCardAlerts } from "@/lib/domains/cards";
import { ApiRequestError } from "@/lib/api-security";

const IngestAlertSchema = z.object({
  rawBody: z.string().min(20),
  rawSubject: z.string().max(255).optional(),
});

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    return NextResponse.json(await listCardAlerts(workspaceId, request));
  } catch (error) {
    if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to fetch alert staging" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
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
