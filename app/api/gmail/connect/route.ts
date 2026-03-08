import { buildGmailConsentUrl } from "@/lib/gmail";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { workspaceId, userId } = await requireWorkspaceAccess();
    const origin = new URL(request.url).origin;
    const statePayload = Buffer.from(JSON.stringify({ workspaceId, userId }), "utf8").toString("base64url");
    const url = buildGmailConsentUrl({ state: statePayload, origin });
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to prepare Gmail connect URL", message }, { status: 500 });
  }
}

