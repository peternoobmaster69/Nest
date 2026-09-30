import { parseJsonBody } from "@/lib/api-security";
import { AgentConfigurationUpdateSchema } from "@/lib/ai/agent-contracts";
import { getAgentDetail, saveAgentConfiguration } from "@/lib/ai/agent-store";
import { agentRouteId, runAdminAgentRoute, type AgentRouteContext } from "@/lib/ai/agent-admin-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: AgentRouteContext) {
  return runAdminAgentRoute(request, {}, async () => Response.json(await getAgentDetail(await agentRouteId(context))));
}
export async function PATCH(request: Request, context: AgentRouteContext) {
  return runAdminAgentRoute(request, { mutation: true }, async (actor) => {
    const input = await parseJsonBody(request, AgentConfigurationUpdateSchema);
    return Response.json(await saveAgentConfiguration(await agentRouteId(context), input, actor));
  });
}
