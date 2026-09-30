import { parseJsonBody } from "@/lib/api-security";
import { AgentEvaluationRequestSchema } from "@/lib/ai/agent-contracts";
import { evaluateAgent } from "@/lib/ai/agent-training";
import { agentRouteId, runAdminAgentRoute, type AgentRouteContext } from "@/lib/ai/agent-admin-api";
export const maxDuration = 180;
export async function POST(request: Request, context: AgentRouteContext) {
  return runAdminAgentRoute(request, { mutation: true, modelCall: true }, async (actor) => Response.json(
    await evaluateAgent(await agentRouteId(context), await parseJsonBody(request, AgentEvaluationRequestSchema), actor),
  ));
}
