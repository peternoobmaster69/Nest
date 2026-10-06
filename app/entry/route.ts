import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { buildWorkspacePath, normalizeInternalAppPath } from "@/lib/workspace-entry";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const workspaceId = requestUrl.searchParams.get("workspaceId")?.trim();
  const destination = normalizeInternalAppPath(requestUrl.searchParams.get("next"));

  try {
    const selectedWorkspaceId = workspaceId
      ? (await requireWorkspaceAccess(workspaceId)).workspaceId
      : (await requireWorkspaceAccess()).workspaceId;
    const scopedDestination = buildWorkspacePath(selectedWorkspaceId, destination);
    return new Response(null, { status: 307, headers: { Location: scopedDestination } });
  } catch (error) {
    if (error instanceof ApiAuthError && error.status === 401) {
      const params = new URLSearchParams({ callbackUrl: `${requestUrl.pathname}${requestUrl.search}` });
      return new Response(null, { status: 307, headers: { Location: `/login?${params}` } });
    }
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Workspace entry failed", error);
    return NextResponse.json({ error: "Unable to open workspace" }, { status: 500 });
  }
}
