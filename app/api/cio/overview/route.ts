import { runSecureApiRoute } from "@/lib/api-security";
import { buildCioSnapshot } from "@/lib/domains/cio/snapshot-service";

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO overview",
  }, async ({ auth }) => {
    const overview = await buildCioSnapshot({
      workspaceId: auth!.workspaceId,
    });
    return Response.json({ overview });
  });
}
