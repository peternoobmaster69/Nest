import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
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
}
