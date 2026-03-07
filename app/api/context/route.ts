import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        financials: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
        },
        members: {
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json({
        workspaceId: null,
        defaultAccountId: null,
        defaultUserId: null,
        accounts: [],
      });
    }

    return NextResponse.json({
      workspaceId: workspace.id,
      defaultAccountId: null,
      defaultUserId: workspace.members[0]?.userId ?? null,
      accounts: workspace.financials.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
      })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      if (error.status === 404) {
        return NextResponse.json({
          workspaceId: null,
          defaultAccountId: null,
          defaultUserId: null,
          accounts: [],
        });
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load context", message }, { status: 500 });
  }
}
