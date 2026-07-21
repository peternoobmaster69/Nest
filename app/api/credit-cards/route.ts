import { prisma } from "@/lib/prisma";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateCreditCardSchema = z.object({
  workspaceId: z.string().min(1),
  cardName: z.string().min(1).max(120),
  bankName: z.string().max(120).optional(),
  themeKey: z.string().max(60).optional(),
  last4Digit: z.string().regex(/^\d{4}$/),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().min(2000).max(2100).optional(),
  statementDay: z.number().int().min(1).max(31),
  paymentDueDay: z.number().int().min(1).max(31),
  notes: z.string().max(500).optional(),
}).strict();

function maskedFromLast4(last4: string) {
  return `•••• •••• •••• ${last4}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess(workspaceId);

    const cards = await prisma.creditCardAccount.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        cardName: true,
        bankName: true,
        themeKey: true,
        last4Digit: true,
        statementDay: true,
        paymentDueDay: true,
        expiryMonth: true,
        expiryYear: true,
        notes: true,
        bonusLimitCents: true,
        bonusStatementCents: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      cards.map((card) => {
        return {
          ...card,
          maskedNumber: maskedFromLast4(card.last4Digit),
        };
      }),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to fetch credit cards", error);
    return NextResponse.json({ error: "Failed to fetch credit cards" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to create credit card" }, async () => {
   try {
    const parsed = { data: await parseJsonBody(request, CreateCreditCardSchema, 16 * 1024) };

    await requireWorkspaceAccess(parsed.data.workspaceId, "EDITOR");

    const created = await prisma.creditCardAccount.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        cardName: parsed.data.cardName.trim(),
        bankName: parsed.data.bankName?.trim() || null,
        themeKey: parsed.data.themeKey?.trim() || null,
        last4Digit: parsed.data.last4Digit,
        expiryMonth: parsed.data.expiryMonth ?? null,
        expiryYear: parsed.data.expiryYear ?? null,
        statementDay: parsed.data.statementDay,
        paymentDueDay: parsed.data.paymentDueDay,
        notes: parsed.data.notes?.trim() || null,
        isActive: true,
      },
      select: {
        id: true,
        cardName: true,
        bankName: true,
        themeKey: true,
        last4Digit: true,
        statementDay: true,
        paymentDueDay: true,
        expiryMonth: true,
        expiryYear: true,
        notes: true,
        bonusLimitCents: true,
        bonusStatementCents: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        ...created,
        maskedNumber: maskedFromLast4(created.last4Digit),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
   }
  });
}
