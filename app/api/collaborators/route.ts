import { NextResponse } from "next/server";
import { runSecureApiRoute } from "@/lib/api-security";
import { getCollaborators } from "@/lib/domains/workspaces";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  return runSecureApiRoute(
    request,
    { auth: { workspaceId }, errorMessage: "Failed to load collaborators" },
    async ({ auth }) => NextResponse.json(
      await getCollaborators(workspaceId, auth!.role, request),
    ),
  );
}
