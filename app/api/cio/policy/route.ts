import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioPolicyInputSchema } from "@/lib/domains/cio/contracts";
import { getCioPolicy, upsertCioPolicy } from "@/lib/domains/cio/repository";
import { withoutPolicyScope, withoutWorkspaceScope } from "../_response";

function publicPolicy<T extends {
  workspaceId: unknown;
  assetClassBands: Array<{ workspaceId: unknown; policyId: unknown }>;
  geographyLimits: Array<{ workspaceId: unknown; policyId: unknown }>;
}>(policy: T) {
  return {
    ...withoutWorkspaceScope(policy),
    assetClassBands: policy.assetClassBands.map(withoutPolicyScope),
    geographyLimits: policy.geographyLimits.map(withoutPolicyScope),
  };
}

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO policy",
  }, async ({ auth }) => {
    const policy = await getCioPolicy(auth!.workspaceId);
    return Response.json({ policy: policy ? publicPolicy(policy) : null });
  });
}

export async function PATCH(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to update CIO policy",
  }, async ({ auth }) => {
    const data = await parseJsonBody(request, CioPolicyInputSchema, 32 * 1024);
    const policy = await upsertCioPolicy({
      workspaceId: auth!.workspaceId,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ policy: publicPolicy(policy) });
  });
}
