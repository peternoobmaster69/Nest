import { parseJsonBody } from "@/lib/api-security";
import { AgentFineTuneRequestSchema } from "@/lib/ai/agent-contracts";
import { startAgentFineTuning } from "@/lib/ai/agent-fine-tuning";
import { agentRouteId, runAdminAgentRoute, type AgentRouteContext } from "@/lib/ai/agent-admin-api";
export const maxDuration = 180;
export async function POST(request: Request, context: AgentRouteContext) {
  return runAdminAgentRoute(request, { mutation: true, modelCall: true }, async (actor) => Response.json(
    await startAgentFineTuning(await agentRouteId(context), await parseJsonBody(request, AgentFineTuneRequestSchema), actor), { status: 201 },
  ));
}
