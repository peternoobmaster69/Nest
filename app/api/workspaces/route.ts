import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireSessionUserId } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      take: 100,
      include: {
        workspace: {
          select: { id: true, name: true, baseCurrency: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        baseCurrency: m.workspace.baseCurrency,
        role: m.role,
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load workspaces", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const parsed = CreateWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
    }

    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.name.trim(),
        baseCurrency: "SGD",
        isShared: false,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "OWNER",
      },
    });

    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: userId,
        action: "WORKSPACE_CREATED",
        details: `Workspace "${workspace.name}" created.`,
      },
    });

    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create workspace", message }, { status: 500 });
  }
}
