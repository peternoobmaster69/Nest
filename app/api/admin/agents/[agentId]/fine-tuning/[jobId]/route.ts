import { z } from "zod";
import { parseJsonBody } from "@/lib/api-security";
import { AgentFineTuneActionSchema } from "@/lib/ai/agent-contracts";
import { updateAgentFineTuning } from "@/lib/ai/agent-fine-tuning";
import { agentRouteId, runAdminAgentRoute } from "@/lib/ai/agent-admin-api";
type Context = { params: Promise<{ agentId: string; jobId: string }> };
export async function POST(request: Request, context: Context) {
  return runAdminAgentRoute(request, { mutation: true }, async () => {
    const input = await parseJsonBody(request, AgentFineTuneActionSchema);
    const jobId = z.string().min(1).max(191).parse((await context.params).jobId);
    return Response.json(await updateAgentFineTuning(await agentRouteId(context), jobId, input.action));
  });
}
