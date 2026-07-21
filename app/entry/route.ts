import { setActiveWorkspaceCookie } from "@/lib/active-workspace";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { normalizeInternalAppPath } from "@/lib/workspace-entry";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const workspaceId = requestUrl.searchParams.get("workspaceId")?.trim();
  const destination = normalizeInternalAppPath(requestUrl.searchParams.get("next"));

  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace is required" }, { status: 400 });
  }

  try {
    await requireWorkspaceAccess(workspaceId);
    const response = NextResponse.redirect(new URL(destination, requestUrl.origin));
    return setActiveWorkspaceCookie(response, workspaceId);
  } catch (error) {
    if (error instanceof ApiAuthError && error.status === 401) {
      const signInUrl = new URL("/login", requestUrl.origin);
      signInUrl.searchParams.set("callbackUrl", `${requestUrl.pathname}${requestUrl.search}`);
      return NextResponse.redirect(signInUrl);
    }
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Workspace entry failed", error);
    return NextResponse.json({ error: "Unable to open workspace" }, { status: 500 });
  }
}
