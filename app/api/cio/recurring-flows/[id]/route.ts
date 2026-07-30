import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioBoundedIdSchema, CioRecurringFlowUpdateSchema } from "@/lib/domains/cio/contracts";
import {
  deleteCioRecurringFlow,
  updateCioRecurringFlow,
} from "@/lib/domains/cio/repository";
import { withoutWorkspaceScope } from "../../_response";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to update CIO recurring flow",
  }, async ({ auth }) => {
    const id = CioBoundedIdSchema.parse((await params).id);
    const data = await parseJsonBody(request, CioRecurringFlowUpdateSchema, 16 * 1024);
    const flow = await updateCioRecurringFlow({
      workspaceId: auth!.workspaceId,
      id,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ flow: withoutWorkspaceScope(flow) });
  });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to delete CIO recurring flow",
  }, async ({ auth }) => {
    const id = CioBoundedIdSchema.parse((await params).id);
    const deleted = await deleteCioRecurringFlow({
      workspaceId: auth!.workspaceId,
      id,
      actorUserId: auth!.userId,
    });
    return Response.json({ deleted });
  });
}
