import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateContextSchema = z.object({
  workspaceId: z.string().min(1),
  baseCurrency: z.enum(["SGD", "USD", "EUR", "GBP", "AUD", "JPY"]),
});

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
        baseCurrency: "SGD",
        accounts: [],
      });
    }

    return NextResponse.json({
      workspaceId: workspace.id,
      defaultAccountId: null,
      defaultUserId: workspace.members[0]?.userId ?? null,
      baseCurrency: workspace.baseCurrency || "SGD",
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
          baseCurrency: "SGD",
          accounts: [],
        });
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load context", message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = UpdateContextSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await requireWorkspaceAccess(parsed.data.workspaceId);

    const updated = await prisma.workspace.update({
      where: { id: parsed.data.workspaceId },
      data: { baseCurrency: parsed.data.baseCurrency },
      select: { id: true, baseCurrency: true },
    });

    return NextResponse.json({ workspaceId: updated.id, baseCurrency: updated.baseCurrency });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update context", message }, { status: 500 });
  }
}
