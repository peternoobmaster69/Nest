import { runSecureApiRoute } from "@/lib/api-security";
import { CioBoundedIdSchema } from "@/lib/domains/cio/contracts";
import { getCioStrategyReport } from "@/lib/domains/cio/report-repository";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO strategy report",
  }, async ({ auth }) => {
    const id = CioBoundedIdSchema.parse((await params).id);
    const result = await getCioStrategyReport(auth!.workspaceId, id);
    return Response.json({ id: result.id, report: result.report });
  });
}
