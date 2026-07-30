import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { CioRecurringFlowCreateSchema } from "@/lib/domains/cio/contracts";
import {
  createCioRecurringFlow,
  listCioRecurringFlows,
} from "@/lib/domains/cio/repository";
import { withoutWorkspaceScope } from "../_response";

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "VIEWER" },
    noStore: true,
    errorMessage: "Failed to load CIO recurring flows",
  }, async ({ auth }) => {
    const flows = await listCioRecurringFlows(auth!.workspaceId);
    return Response.json({ items: flows.map(withoutWorkspaceScope) });
  });
}

export async function POST(request: Request) {
  return runSecureApiRoute(request, {
    auth: { minimumRole: "EDITOR" },
    mutation: true,
    noStore: true,
    errorMessage: "Failed to create CIO recurring flow",
  }, async ({ auth }) => {
    const data = await parseJsonBody(request, CioRecurringFlowCreateSchema, 16 * 1024);
    const flow = await createCioRecurringFlow({
      workspaceId: auth!.workspaceId,
      actorUserId: auth!.userId,
      data,
    });
    return Response.json({ flow: withoutWorkspaceScope(flow) }, { status: 201 });
  });
}
