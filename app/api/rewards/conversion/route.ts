import { prisma } from "@/lib/prisma";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { deleteWorkspaceReward, rewardFailureResponse } from "@/lib/domains/rewards/api";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateConversionSchema = z.object({
  creditCardRewardId: z.string(),
  frequentFlyerId: z.string(),
  fromPoints: z.number().int().min(1),
  toMiles: z.number().int().min(1),
  description: z.string().optional(),
});

const UpdateConversionSchema = z.object({
  id: z.string(),
  fromPoints: z.number().int().min(1).optional(),
  toMiles: z.number().int().min(1).optional(),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");

    const body = await request.json();
    const parsed = CreateConversionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: z.flattenError(parsed.error) }, { status: 400 });
    }

    const { creditCardRewardId, frequentFlyerId, fromPoints, toMiles, description } = parsed.data;

    const conversionRate = toMiles / fromPoints;

    const [reward, flyer] = await Promise.all([
      prisma.creditCardReward.findFirst({
        where: { id: creditCardRewardId, workspaceId },
      }),
      prisma.frequentFlyerAccount.findFirst({
        where: { id: frequentFlyerId, workspaceId },
      }),
    ]);

    if (!reward) {
      return NextResponse.json({ error: "Credit card reward not found" }, { status: 404 });
    }

    if (!flyer) {
      return NextResponse.json({ error: "Frequent flyer account not found" }, { status: 404 });
    }

    const conversion = await prisma.pointConversion.create({
      data: {
        workspaceId,
        creditCardRewardId,
        frequentFlyerId,
        fromPoints,
        toMiles,
        conversionRate,
        description,
      },
      include: {
        creditCardReward: { include: { creditCard: true } },
        frequentFlyer: true,
      },
    });

    return NextResponse.json({ ...conversion, conversionRate: Number(conversion.conversionRate) }, { status: 201 });
  } catch (error) {
    return rewardFailureResponse(error, "Failed to create conversion");
  }
}

export async function DELETE(request: Request) {
  return deleteWorkspaceReward(request, prisma.pointConversion, "Conversion");
}

export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");

    const body = await request.json();
    const parsed = UpdateConversionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: z.flattenError(parsed.error) }, { status: 400 });
    }

    const existing = await prisma.pointConversion.findFirst({
      where: { id: parsed.data.id, workspaceId },
      select: { fromPoints: true, toMiles: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Conversion not found" }, { status: 404 });
    }

    const fromPoints = parsed.data.fromPoints ?? existing.fromPoints;
    const toMiles = parsed.data.toMiles ?? existing.toMiles;
    const conversionRate = toMiles / fromPoints;

    const updated = await prisma.pointConversion.update({
      where: { id: parsed.data.id },
      data: {
        ...(parsed.data.fromPoints !== undefined && { fromPoints: parsed.data.fromPoints }),
        ...(parsed.data.toMiles !== undefined && { toMiles: parsed.data.toMiles }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description || null }),
        conversionRate,
      },
      include: {
        creditCardReward: { include: { creditCard: true } },
        frequentFlyer: true,
      },
    });

    return NextResponse.json({ ...updated, conversionRate: Number(updated.conversionRate) });
  } catch (error) {
    return rewardFailureResponse(error, "Failed to update conversion");
  }
}
