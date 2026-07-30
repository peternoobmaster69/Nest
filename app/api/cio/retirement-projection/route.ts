import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioRetirementProjectionInputSchema } from "@/lib/domains/cio/contracts";
import { runWorkspaceRetirementProjection } from "@/lib/domains/cio/snapshot-service";

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to run CIO retirement projection",
  }, async ({ auth }) => {
    const input = await parseJsonBody(
      request,
      CioRetirementProjectionInputSchema,
      8 * 1024,
    );
    const projection = await runWorkspaceRetirementProjection({
      workspaceId: auth!.workspaceId,
      input,
    });
    return Response.json({ projection });
  });
}
