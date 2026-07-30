import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioBoundedIdSchema, CioExposuresInputSchema } from "@/lib/domains/cio/contracts";
import {
  getCioInvestmentExposures,
  replaceCioInvestmentExposures,
} from "@/lib/domains/cio/repository";
import { withoutExposureStorageKey } from "../../../_response";

type RouteContext = { params: Promise<{ investmentId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO investment exposures",
  }, async ({ auth }) => {
    const investmentAccountId = CioBoundedIdSchema.parse((await params).investmentId);
    const exposures = await getCioInvestmentExposures({
      workspaceId: auth!.workspaceId,
      investmentAccountId,
    });
    return Response.json({
      exposures: exposures.map(withoutExposureStorageKey),
    });
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to update CIO investment exposures",
  }, async ({ auth }) => {
    const investmentAccountId = CioBoundedIdSchema.parse((await params).investmentId);
    const data = await parseJsonBody(request, CioExposuresInputSchema, 32 * 1024);
    const exposures = await replaceCioInvestmentExposures({
      workspaceId: auth!.workspaceId,
      investmentAccountId,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({
      exposures: exposures.map(withoutExposureStorageKey),
    });
  });
}
