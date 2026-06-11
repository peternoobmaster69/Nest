import { getWorkspaceNetWorthPayload } from "@/lib/net-worth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const PUBLIC_NET_WORTH_HEADERS = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!token || token.length < 24) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        publicNetWorthEnabled: true,
        publicNetWorthToken: token,
      },
      select: { id: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const payload = await getWorkspaceNetWorthPayload(prisma, workspace.id);
    return NextResponse.json(payload, { headers: PUBLIC_NET_WORTH_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to load net worth", message }, { status: 500 });
  }
}
