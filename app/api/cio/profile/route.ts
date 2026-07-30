import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioProfileInputSchema } from "@/lib/domains/cio/contracts";
import { getCioProfile, upsertCioProfile } from "@/lib/domains/cio/repository";
import { withoutWorkspaceScope } from "../_response";

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO profile",
  }, async ({ auth }) => {
    const profile = await getCioProfile(auth!.workspaceId);
    return Response.json({
      profile: profile ? withoutWorkspaceScope(profile) : null,
    });
  });
}

export async function PATCH(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to update CIO profile",
  }, async ({ auth }) => {
    const data = await parseJsonBody(request, CioProfileInputSchema, 16 * 1024);
    const profile = await upsertCioProfile({
      workspaceId: auth!.workspaceId,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ profile: withoutWorkspaceScope(profile) });
  });
}
