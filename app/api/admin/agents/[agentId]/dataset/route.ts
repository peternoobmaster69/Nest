import { z } from "zod";
import { buildAgentDataset, loadAgentTrainingSnapshot } from "@/lib/ai/agent-training";
import { agentRouteId, runAdminAgentRoute, type AgentRouteContext } from "@/lib/ai/agent-admin-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: AgentRouteContext) {
  return runAdminAgentRoute(request, {}, async () => {
    const id = await agentRouteId(context);
    const purpose = z.enum(["TRAINING", "EVALUATION"]).parse(new URL(request.url).searchParams.get("purpose") ?? "TRAINING");
    const snapshot = await loadAgentTrainingSnapshot(id);
    return new Response(buildAgentDataset(snapshot.configuration, snapshot.examples, purpose), { headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": `attachment; filename="${id}-${purpose.toLowerCase()}.jsonl"`,
    } });
  });
}
