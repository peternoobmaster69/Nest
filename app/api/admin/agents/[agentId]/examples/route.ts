import { parseJsonBody } from "@/lib/api-security";
import { AgentExampleSchema } from "@/lib/ai/agent-contracts";
import { saveAgentExample } from "@/lib/ai/agent-store";
import { agentRouteId, runAdminAgentRoute, type AgentRouteContext } from "@/lib/ai/agent-admin-api";
export async function POST(request: Request, context: AgentRouteContext) {
  return runAdminAgentRoute(request, { mutation: true }, async (actor) => Response.json(
    await saveAgentExample(await agentRouteId(context), await parseJsonBody(request, AgentExampleSchema, 160_000), actor), { status: 201 },
  ));
}
