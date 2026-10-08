import { publicWorkspaceResponse } from "@/lib/api/public-workspace";
import { getWorkspaceNetWorthPayload } from "@/lib/net-worth";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return publicWorkspaceResponse(request, params, {
    scope: "public-net-worth",
    errorMessage: "Failed to load net worth",
    load: getWorkspaceNetWorthPayload,
  });
}
