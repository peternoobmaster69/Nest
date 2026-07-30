import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioPlanningPositionCreateSchema } from "@/lib/domains/cio/contracts";
import {
  createCioPlanningPosition,
  listCioPlanningPositions,
} from "@/lib/domains/cio/repository";
import { withoutWorkspaceScope } from "../_response";

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO planning positions",
  }, async ({ auth }) => {
    const positions = await listCioPlanningPositions(auth!.workspaceId);
    return Response.json({ items: positions.map(withoutWorkspaceScope) });
  });
}

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to create CIO planning position",
  }, async ({ auth }) => {
    const data = await parseJsonBody(request, CioPlanningPositionCreateSchema, 16 * 1024);
    const position = await createCioPlanningPosition({
      workspaceId: auth!.workspaceId,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ position: withoutWorkspaceScope(position) }, { status: 201 });
  });
}
