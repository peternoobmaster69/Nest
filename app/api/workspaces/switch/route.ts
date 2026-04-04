import { setActiveWorkspaceCookie } from "@/lib/active-workspace";
import { ApiAuthError, requireSessionUserId, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const SwitchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    await requireSessionUserId();
    const parsed = SwitchWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await requireWorkspaceAccess(parsed.data.workspaceId);

    const response = NextResponse.json({ workspaceId: parsed.data.workspaceId, ok: true });
    return setActiveWorkspaceCookie(response, parsed.data.workspaceId);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to switch workspace", message }, { status: 500 });
  }
}
