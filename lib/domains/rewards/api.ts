import { NextResponse } from "next/server";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

type RewardDeleteRepository = {
  findFirst(args: {
    where: { id: string; workspaceId: string };
    select: { id: true };
  }): PromiseLike<{ id: string } | null>;
  delete(args: { where: { id: string } }): PromiseLike<unknown>;
};

export function rewardFailureResponse(error: unknown, message: string) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function deleteWorkspaceReward(
  request: Request,
  repository: RewardDeleteRepository,
  resourceName: string,
) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const existing = await repository.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: `${resourceName} not found` }, { status: 404 });
    }
    await repository.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return rewardFailureResponse(error, `Failed to delete ${resourceName.toLowerCase()}`);
  }
}
