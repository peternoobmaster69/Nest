import { prisma } from "@/lib/prisma";
import { parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { ApiAuthError, requireSessionUserId, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateCreditCardSchema = z.object({
  cardName: z.string().min(1).max(120).optional(),
  bankName: z.string().max(120).nullable().optional(),
  themeKey: z.string().max(60).nullable().optional(),
  last4Digit: z.string().regex(/^\d{4}$/).optional(),
  expiryMonth: z.number().int().min(1).max(12).nullable().optional(),
  expiryYear: z.number().int().min(2000).max(2100).nullable().optional(),
  statementDay: z.number().int().min(1).max(31).optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

function maskedFromLast4(last4: string) {
  return `•••• •••• •••• ${last4}`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionUserId();

    const { id } = await params;
    const card = await prisma.creditCardAccount.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
      },
    });

    if (!card) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    await requireWorkspaceAccess(card.workspaceId);

    return NextResponse.json(
      { error: "Card detail reveal is disabled" },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("Failed to handle credit card detail reveal", error);
    return NextResponse.json(
      { error: "Failed to reveal credit card" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runSecureApiRoute(request, { mutation: true, errorMessage: "Failed to update credit card" }, async () => {
   try {
    const { id } = await params;
    const parsed = { data: await parseJsonBody(request, UpdateCreditCardSchema, 16 * 1024) };

    const existing = await prisma.creditCardAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    const data: {
      cardName?: string;
      bankName?: string | null;
      themeKey?: string | null;
      statementDay?: number;
      paymentDueDay?: number;
      expiryMonth?: number | null;
      expiryYear?: number | null;
      notes?: string | null;
      isActive?: boolean;
      last4Digit?: string;
    } = {};

    if (parsed.data.cardName !== undefined) data.cardName = parsed.data.cardName.trim();
    if (parsed.data.bankName !== undefined) data.bankName = parsed.data.bankName ? parsed.data.bankName.trim() : null;
    if (parsed.data.themeKey !== undefined) data.themeKey = parsed.data.themeKey ? parsed.data.themeKey.trim() : null;
    if (parsed.data.statementDay !== undefined) data.statementDay = parsed.data.statementDay;
    if (parsed.data.paymentDueDay !== undefined) data.paymentDueDay = parsed.data.paymentDueDay;
    if (parsed.data.expiryMonth !== undefined) data.expiryMonth = parsed.data.expiryMonth;
    if (parsed.data.expiryYear !== undefined) data.expiryYear = parsed.data.expiryYear;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes ? parsed.data.notes.trim() : null;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    if (parsed.data.last4Digit !== undefined) data.last4Digit = parsed.data.last4Digit;

    let updated;
    try {
      updated = await prisma.creditCardAccount.update({
        where: { id },
        data,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unknown argument `themeKey`")) throw error;
      const { themeKey: _omitTheme, ...dataWithoutTheme } = data;
      const fallback = await prisma.creditCardAccount.update({
        where: { id },
        data: dataWithoutTheme,
        select: {
          id: true,
          cardName: true,
          bankName: true,
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
      updated = { ...fallback, themeKey: null };
    }

    return NextResponse.json({
      ...updated,
      maskedNumber: maskedFromLast4(updated.last4Digit),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
   }
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const existing = await prisma.creditCardAccount.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Credit card not found" }, { status: 404 });
    }

    await requireWorkspaceAccess(existing.workspaceId, "EDITOR");

    await prisma.creditCardAccount.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to delete credit card", error);
    return NextResponse.json({ error: "Failed to delete credit card" }, { status: 500 });
  }
}
