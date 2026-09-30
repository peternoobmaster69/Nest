import { APIError } from "openai";
import { Prisma } from "@prisma/client";
import { isAdminEmail } from "@/lib/admin-auth";
import { getDatabaseReadyServerSession } from "@/lib/server-session";
import { runSecureApiRoute, ApiRequestError } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { AiConfigurationError } from "./config";
import { AgentIdSchema } from "./agent-contracts";

export type AgentRouteContext = { params: Promise<{ agentId: string }> };
export async function agentRouteId(context: AgentRouteContext) { return AgentIdSchema.parse((await context.params).agentId); }

export function runAdminAgentRoute(request: Request, options: { mutation?: boolean; modelCall?: boolean }, handler: (actorUserId: string) => Promise<Response>) {
  return runSecureApiRoute(request, { mutation: options.mutation, noStore: true, errorMessage: "Agent management is temporarily unavailable." }, async () => {
    const session = await getDatabaseReadyServerSession();
    if (!session?.user?.id) throw new ApiRequestError(401, "Sign in to continue.");
    if (!isAdminEmail(session.user.email)) throw new ApiRequestError(403, "Administrator access is required.");
    if (options.mutation) await enforceDistributedRateLimit(request, { scope: options.modelCall ? "admin-agent-model" : "admin-agent-write",
      identifier: session.user.id, limit: options.modelCall ? 10 : 100, windowMs: 10 * 60_000 });
    try { return await handler(session.user.id); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") throw new ApiRequestError(503, "Agent management needs the latest database migration.");
      if (error instanceof AiConfigurationError) throw new ApiRequestError(503, "Configure the Azure AI connection before running evaluations or training.");
      if (error instanceof APIError) throw new ApiRequestError(error.status === 429 ? 429 : 502, "Azure could not complete this request. Check the resource's access and model support, then retry.");
      throw error;
    }
  });
}
