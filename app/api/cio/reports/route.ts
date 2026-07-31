import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioStrategyReportCreateInputSchema } from "@/lib/domains/cio/contracts";
import {
  createCioStrategyReport,
  listCioStrategyReports,
} from "@/lib/domains/cio/report-repository";

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO strategy reports",
  }, async ({ auth }) => {
    const reports = await listCioStrategyReports(auth!.workspaceId);
    return Response.json({ reports });
  });
}

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to generate CIO strategy report",
  }, async ({ auth }) => {
    const data = await parseJsonBody(request, CioStrategyReportCreateInputSchema, 4 * 1024);
    const created = await createCioStrategyReport({
      workspaceId: auth!.workspaceId,
      actorUserId: auth!.userId,
      asOfDate: data.asOfDate,
    });
    return Response.json({ report: created.summary }, { status: 201 });
  });
}
