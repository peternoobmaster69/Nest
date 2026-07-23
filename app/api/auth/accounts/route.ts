import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireSessionUserId } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    const accounts = await prisma.account.findMany({
      take: 100,
      where: { userId },
      orderBy: { provider: "asc" },
      select: { provider: true },
    });
    return NextResponse.json({ providers: [...new Set(accounts.map((account) => account.provider))] });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unable to load linked accounts" }, { status: 500 });
  }
}
