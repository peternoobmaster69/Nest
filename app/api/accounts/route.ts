import { authOptions } from "@/lib/auth";
import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import { ensureUserWithDefaultWorkspace } from "@/lib/workspace-bootstrap";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateAccountSchema = z.object({
  workspaceId: z.string().optional(),
  name: z.string().max(120).default(""),
  bankName: z.string().min(1).max(120).optional(),
  startingCents: z.number().int().min(0).default(0),
  description: z.string().max(500).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json([]);
    }

    await requireWorkspaceAccess(workspaceId);

    const accounts = await prisma.financialAccount.findMany({
      where: { workspaceId, kind: "BANK" },
      orderBy: { createdAt: "asc" },
    });

    const consistency = await getBankConsistency(prisma, workspaceId);
    const map = new Map(consistency.map((c) => [c.id, c]));

    return NextResponse.json(
      accounts.map((a) => ({
        ...a,
        currentBalanceCents: map.get(a.id)?.currentBalanceCents ?? a.startingCents,
        linkedBudgetTotalCents: map.get(a.id)?.linkedBudgetTotalCents ?? 0,
        discrepancyCents: map.get(a.id)?.discrepancyCents ?? a.startingCents,
      })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch bank accounts", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = CreateAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const sessionUserId = session.user.id;
    const sessionEmail = session.user.email ?? null;
    const sessionName = session.user.name ?? null;

    let userId = sessionUserId;
    const byId = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true },
    });

    if (!byId && sessionEmail) {
      const byEmail = await prisma.user.findUnique({
        where: { email: sessionEmail },
        select: { id: true },
      });
      if (byEmail) {
        userId = byEmail.id;
      }
    }

    await prisma.user.upsert({
      where: { id: userId },
      update: {
        email: sessionEmail ?? undefined,
        name: sessionName ?? undefined,
      },
      create: {
        id: userId,
        email: sessionEmail ?? undefined,
        name: sessionName ?? undefined,
      },
    });

    let workspaceId = parsed.data.workspaceId;

    if (workspaceId) {
      const membership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId,
          },
        },
        select: { workspaceId: true },
      });
      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const workspace = await ensureUserWithDefaultWorkspace({
        id: userId,
        email: sessionEmail,
        name: sessionName,
      });
      workspaceId = workspace.id;
    }

    let bankType = await prisma.accountType.findFirst({
      where: { workspaceId, label: "Bank" },
    });

    if (!bankType) {
      bankType = await prisma.accountType.create({
        data: {
          workspaceId,
          label: "Bank",
          color: "#147349",
          sortOrder: 1,
          isActive: true,
        },
      });
    }

    const accountName = parsed.data.name.trim() || `${parsed.data.bankName || "Bank"} Account`;

    let account;
    try {
      account = await prisma.financialAccount.create({
        data: {
          workspaceId,
          accountTypeId: bankType.id,
          name: accountName,
          bankName: parsed.data.bankName,
          kind: "BANK",
          description: parsed.data.description,
          startingCents: parsed.data.startingCents,
          isActive: true,
          isSynced: false,
        },
      });
    } catch (createError) {
      const createMessage = createError instanceof Error ? createError.message : "";
      if (createMessage.includes("Unknown argument `bankName`")) {
        account = await prisma.financialAccount.create({
          data: {
            workspaceId,
            accountTypeId: bankType.id,
            name: accountName,
            kind: "BANK",
            description: parsed.data.description,
            startingCents: parsed.data.startingCents,
            isActive: true,
            isSynced: false,
          },
        });
      } else {
        throw createError;
      }
    }

    return NextResponse.json({ workspaceId, account }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("Unknown argument `bankName`")) {
      return NextResponse.json(
        {
          error: "Prisma client is out of date for bankName.",
          message: "Run `npm run prisma:generate` and restart `npm run dev`.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "Failed to create bank account", message }, { status: 500 });
  }
}
