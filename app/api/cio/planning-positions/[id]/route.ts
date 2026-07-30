import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioBoundedIdSchema, CioPlanningPositionUpdateSchema } from "@/lib/domains/cio/contracts";
import {
  deleteCioPlanningPosition,
  updateCioPlanningPosition,
} from "@/lib/domains/cio/repository";
import { withoutWorkspaceScope } from "../../_response";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to update CIO planning position",
  }, async ({ auth }) => {
    const id = CioBoundedIdSchema.parse((await params).id);
    const data = await parseJsonBody(request, CioPlanningPositionUpdateSchema, 16 * 1024);
    const position = await updateCioPlanningPosition({
      workspaceId: auth!.workspaceId,
      id,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ position: withoutWorkspaceScope(position) });
  });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to delete CIO planning position",
  }, async ({ auth }) => {
    const id = CioBoundedIdSchema.parse((await params).id);
    const deleted = await deleteCioPlanningPosition({
      workspaceId: auth!.workspaceId,
      id,
      actorUserId: auth!.userId,
    });
    return Response.json({ deleted });
  });
}
