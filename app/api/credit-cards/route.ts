import { encryptText } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateCreditCardSchema = z.object({
  workspaceId: z.string().min(1),
  cardName: z.string().min(1).max(120),
  bankName: z.string().max(120).optional(),
  themeKey: z.string().max(60).optional(),
  cardNumber: z.string().regex(/^\d{16}$/).optional(),
  securityCode: z.string().regex(/^\d{3,4}$/).optional(),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().min(2000).max(2100).optional(),
  statementDay: z.number().int().min(1).max(31),
  paymentDueDay: z.number().int().min(1).max(31),
  notes: z.string().max(500).optional(),
});

function normalizeCardNumber(value: string) {
  return value.replace(/\D/g, "");
}

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

    let cards;
    try {
      cards = await prisma.creditCardAccount.findMany({
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
          encryptedCardNumber: true,
          encryptedSecurityCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unknown field `themeKey`")) throw error;
      const fallbackCards = await prisma.creditCardAccount.findMany({
        where: { workspaceId, isActive: true },
        orderBy: { updatedAt: "desc" },
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
      cards = fallbackCards.map((card) => ({ ...card, themeKey: null }));
    }

    return NextResponse.json(
      cards.map((card) => {
        const { encryptedCardNumber, encryptedSecurityCode, ...safeCard } = card;
        return {
          ...safeCard,
          maskedNumber: maskedFromLast4(card.last4Digit),
          hasCardNumber: Boolean(encryptedCardNumber),
          hasSecurityCode: Boolean(encryptedSecurityCode),
        };
      }),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to fetch credit cards", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = CreateCreditCardSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    await requireWorkspaceAccess(parsed.data.workspaceId);

    const normalizedCardNumber = parsed.data.cardNumber ? normalizeCardNumber(parsed.data.cardNumber) : "";
    const last4Digit = normalizedCardNumber ? normalizedCardNumber.slice(-4) : "0000";

    let encryptedCardNumber: Buffer | null = null;
    let encryptionIv: Buffer | null = null;
    let encryptionTag: Buffer | null = null;
    let encryptedSecurityCodeBytes: Buffer | null = null;
    let securityCodeIv: Buffer | null = null;
    let securityCodeTag: Buffer | null = null;

    if (normalizedCardNumber) {
      try {
        const encrypted = encryptText(normalizedCardNumber);
        encryptedCardNumber = encrypted.encrypted;
        encryptionIv = encrypted.iv;
        encryptionTag = encrypted.tag;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`Card number encryption failed: ${message}`);
      }
    }

    if (parsed.data.securityCode) {
      try {
        const encrypted = encryptText(parsed.data.securityCode);
        encryptedSecurityCodeBytes = encrypted.encrypted;
        securityCodeIv = encrypted.iv;
        securityCodeTag = encrypted.tag;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        throw new Error(`CVV encryption failed: ${message}`);
      }
    }

    let created;
    try {
      created = await prisma.creditCardAccount.create({
        data: {
          workspaceId: parsed.data.workspaceId,
          cardName: parsed.data.cardName.trim(),
          bankName: parsed.data.bankName?.trim() || null,
          themeKey: parsed.data.themeKey?.trim() || null,
          last4Digit,
          expiryMonth: parsed.data.expiryMonth ?? null,
          expiryYear: parsed.data.expiryYear ?? null,
          statementDay: parsed.data.statementDay,
          paymentDueDay: parsed.data.paymentDueDay,
          notes: parsed.data.notes?.trim() || null,
          encryptedCardNumber,
          encryptedSecurityCode: encryptedSecurityCodeBytes,
          securityCodeIv,
          securityCodeTag,
          encryptionIv,
          encryptionTag,
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
          encryptedCardNumber: true,
          encryptedSecurityCode: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unknown argument `themeKey`")) throw error;
      const fallback = await prisma.creditCardAccount.create({
        data: {
          workspaceId: parsed.data.workspaceId,
          cardName: parsed.data.cardName.trim(),
          bankName: parsed.data.bankName?.trim() || null,
          last4Digit,
          expiryMonth: parsed.data.expiryMonth ?? null,
          expiryYear: parsed.data.expiryYear ?? null,
          statementDay: parsed.data.statementDay,
          paymentDueDay: parsed.data.paymentDueDay,
          notes: parsed.data.notes?.trim() || null,
          encryptedCardNumber,
          encryptedSecurityCode: encryptedSecurityCodeBytes,
          securityCodeIv,
          securityCodeTag,
          encryptionIv,
          encryptionTag,
          isActive: true,
        },
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
      created = { ...fallback, themeKey: null };
    }

    const {
      encryptedCardNumber: encryptedCardNumberBlob,
      encryptedSecurityCode: encryptedSecurityCodeBlob,
      ...safeCreated
    } = created;
    return NextResponse.json(
      {
        ...safeCreated,
        maskedNumber: maskedFromLast4(created.last4Digit),
        hasCardNumber: Boolean(encryptedCardNumberBlob),
        hasSecurityCode: Boolean(encryptedSecurityCodeBlob),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to create credit card", message }, { status: 500 });
  }
}
