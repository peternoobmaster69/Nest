import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import {
  CioBoundedIdSchema,
  CioInvestmentProfileInputSchema,
} from "@/lib/domains/cio/contracts";
import {
  getCioInvestmentProfile,
  upsertCioInvestmentProfile,
} from "@/lib/domains/cio/repository";
import { withoutWorkspaceScope } from "../../../_response";

type RouteContext = { params: Promise<{ investmentId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO investment profile",
  }, async ({ auth }) => {
    const investmentAccountId = CioBoundedIdSchema.parse((await params).investmentId);
    const profile = await getCioInvestmentProfile({
      workspaceId: auth!.workspaceId,
      investmentAccountId,
    });
    return Response.json({
      profile: profile ? withoutWorkspaceScope(profile) : null,
    });
  });
}

export async function PUT(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to update CIO investment profile",
  }, async ({ auth }) => {
    const investmentAccountId = CioBoundedIdSchema.parse((await params).investmentId);
    const data = await parseJsonBody(request, CioInvestmentProfileInputSchema, 8 * 1024);
    const profile = await upsertCioInvestmentProfile({
      workspaceId: auth!.workspaceId,
      investmentAccountId,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ profile: withoutWorkspaceScope(profile) });
  });
}
