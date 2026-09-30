import { z } from "zod";
import { parseJsonBody } from "@/lib/api-security";
import { AgentExampleUpdateSchema, AgentRevisionSchema } from "@/lib/ai/agent-contracts";
import { deleteAgentExample, saveAgentExample } from "@/lib/ai/agent-store";
import { agentRouteId, runAdminAgentRoute } from "@/lib/ai/agent-admin-api";
type Context = { params: Promise<{ agentId: string; exampleId: string }> };
export async function PUT(request: Request, context: Context) {
  return runAdminAgentRoute(request, { mutation: true }, async (actor) => {
    const { revision, ...input } = await parseJsonBody(request, AgentExampleUpdateSchema, 160_000);
    const exampleId = z.string().min(1).max(191).parse((await context.params).exampleId);
    return Response.json(await saveAgentExample(await agentRouteId(context), input, actor, { id: exampleId, revision }));
  });
}
export async function DELETE(request: Request, context: Context) {
  return runAdminAgentRoute(request, { mutation: true }, async (actor) => {
    const { revision } = await parseJsonBody(request, AgentRevisionSchema);
    const exampleId = z.string().min(1).max(191).parse((await context.params).exampleId);
    await deleteAgentExample(await agentRouteId(context), exampleId, revision, actor);
    return new Response(null, { status: 204 });
  });
}
