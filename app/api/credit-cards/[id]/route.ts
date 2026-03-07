import { authOptions } from "@/lib/auth";
import { decryptText, encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateCreditCardSchema = z.object({
  cardName: z.string().min(1).max(120).optional(),
  bankName: z.string().max(120).nullable().optional(),
  themeKey: z.string().max(60).nullable().optional(),
  cardNumber: z.string().regex(/^\d{16}$/).optional(),
  securityCode: z.string().regex(/^\d{3,4}$/).nullable().optional(),
  expiryMonth: z.number().int().min(1).max(12).nullable().optional(),
  expiryYear: z.number().int().min(2000).max(2100).nullable().optional(),
  statementDay: z.number().int().min(1).max(31).optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  notes: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

function normalizeCardNumber(value: string) {
  return value.replace(/\D/g, "");
}

function maskedFromLast4(last4: string) {
  return `•••• •••• •••• ${last4}`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const card = await prisma.creditCardAccount.findUnique({
      where: { id },
      select: {
        id: true,
        last4Digit: true,
        encryptedCardNumber: true,
        encryptionIv: true,
        encryptionTag: true,
        encryptedSecurityCode: true,
        securityCodeIv: true,
        securityCodeTag: true,
      },
    });

    if (!card) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let fullCardNumber: string | null = null;
    if (card.encryptedCardNumber && card.encryptionIv && card.encryptionTag) {
      try {
        fullCardNumber = decryptText(
          Buffer.from(card.encryptedCardNumber),
          Buffer.from(card.encryptionIv),
          Buffer.from(card.encryptionTag),
        );
      } catch {
        fullCardNumber = null;
      }
    }

    let securityCode: string | null = null;
    if (card.encryptedSecurityCode && card.securityCodeIv && card.securityCodeTag) {
      try {
        securityCode = decryptText(
          Buffer.from(card.encryptedSecurityCode),
          Buffer.from(card.securityCodeIv),
          Buffer.from(card.securityCodeTag),
        );
      } catch {
        securityCode = null;
      }
    }

    return NextResponse.json({
      id: card.id,
      maskedNumber: maskedFromLast4(card.last4Digit),
      fullCardNumber,
      securityCode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to reveal credit card", message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = UpdateCreditCardSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

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
      encryptedCardNumber?: Buffer | null;
      encryptedSecurityCode?: Buffer | null;
      securityCodeIv?: Buffer | null;
      securityCodeTag?: Buffer | null;
      encryptionIv?: Buffer | null;
      encryptionTag?: Buffer | null;
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

    if (parsed.data.cardNumber) {
      const normalized = normalizeCardNumber(parsed.data.cardNumber);
      data.last4Digit = normalized.slice(-4);
      try {
        const encrypted = encryptText(normalized);
        data.encryptedCardNumber = encrypted.encrypted;
        data.encryptionIv = encrypted.iv;
        data.encryptionTag = encrypted.tag;
      } catch {
        // Ignore encryption error and keep old encrypted payload.
      }
    }

    if (parsed.data.securityCode !== undefined) {
      if (!parsed.data.securityCode) {
        data.encryptedSecurityCode = null;
        data.securityCodeIv = null;
        data.securityCodeTag = null;
      } else {
        try {
          const encrypted = encryptText(parsed.data.securityCode);
          data.encryptedSecurityCode = encrypted.encrypted;
          data.securityCodeIv = encrypted.iv;
          data.securityCodeTag = encrypted.tag;
        } catch {
          // Ignore encryption error and keep old encrypted payload.
        }
      }
    }

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
          encryptedCardNumber: true,
          encryptedSecurityCode: true,
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
          encryptedCardNumber: true,
          encryptedSecurityCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      updated = { ...fallback, themeKey: null };
    }

    const { encryptedCardNumber, encryptedSecurityCode, ...safeUpdated } = updated;
    return NextResponse.json({
      ...safeUpdated,
      maskedNumber: maskedFromLast4(updated.last4Digit),
      hasCardNumber: Boolean(encryptedCardNumber),
      hasSecurityCode: Boolean(encryptedSecurityCode),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to update credit card", message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.creditCardAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
