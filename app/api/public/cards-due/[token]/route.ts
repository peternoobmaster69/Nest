import { publicWorkspaceResponse } from "@/lib/api/public-workspace";
import { getWorkspaceCardsDuePayload } from "@/lib/public-card-dues";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return publicWorkspaceResponse(request, params, {
    scope: "public-cards-due",
    errorMessage: "Failed to load cards due",
    load: getWorkspaceCardsDuePayload,
  });
}
