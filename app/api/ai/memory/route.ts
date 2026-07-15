import { NextResponse } from "next/server";
import { z } from "zod";
import { getAskNestOwnerHash, isSafeAskNestMemoryContent } from "@/lib/ai/memory";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const UpdateMemorySchema = z.object({
  id: z.string().min(1).max(1_000),
  content: z.string().trim().min(3).max(240),
}).strict();

export async function GET() {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const ownerHash = getAskNestOwnerHash(workspaceId, userId);
    const memories = await prisma.askNestMemory.findMany({
      where: { workspaceId, userId, ownerHash, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        key: true,
        content: true,
        confidence: true,
        sourceTurnId: true,
        lastConfirmedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ memories }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    console.error("Ask Nest memory load failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not load Ask Nest memory." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const parsed = UpdateMemorySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !isSafeAskNestMemoryContent(parsed.data.content)) {
      return NextResponse.json({ error: "That memory cannot be saved." }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const ownerHash = getAskNestOwnerHash(workspaceId, userId);
    const result = await prisma.askNestMemory.updateMany({
      where: { id: parsed.data.id, workspaceId, userId, ownerHash, status: "ACTIVE" },
      data: { content: parsed.data.content, lastConfirmedAt: new Date() },
    });
    if (result.count !== 1) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const memory = await prisma.askNestMemory.findFirst({
      where: { id: parsed.data.id, workspaceId, userId, ownerHash, status: "ACTIVE" },
      select: { id: true, kind: true, key: true, content: true, updatedAt: true },
    });
    return NextResponse.json({ memory }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    console.error("Ask Nest memory update failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not update Ask Nest memory." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const ownerHash = getAskNestOwnerHash(workspaceId, userId);
    const id = new URL(request.url).searchParams.get("id");
    const result = await prisma.askNestMemory.deleteMany({
      where: { workspaceId, userId, ownerHash, ...(id ? { id } : {}) },
    });
    return NextResponse.json({ deleted: result.count }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    console.error("Ask Nest memory delete failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Could not forget Ask Nest memory." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
