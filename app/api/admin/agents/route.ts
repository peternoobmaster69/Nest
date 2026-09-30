import { getAgentRegistry } from "@/lib/ai/agent-store";
import { runAdminAgentRoute } from "@/lib/ai/agent-admin-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runAdminAgentRoute(request, {}, async () => Response.json(await getAgentRegistry()));
}
