import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { z } from "zod";

const CreateCreditCardRewardSchema = z.object({
  creditCardId: z.string(),
  currentPoints: z.number().int().min(0),
  pointsValueCents: z.number().int().min(0).optional(),
  conversionFromPoints: z.number().int().min(1),
  conversionToMiles: z.number().int().min(1),
  conversionDescription: z.string().max(500).optional(),
});

const UpdateCreditCardRewardSchema = z.object({
  id: z.string(),
  currentPoints: z.number().int().min(0).optional(),
  pointsValueCents: z.number().int().min(0).optional(),
});

export async function POST(request: Request) {
  try {
    const workspace = await prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      return NextResponse.json({ error: "No workspace found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = CreateCreditCardRewardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      creditCardId,
      currentPoints,
      pointsValueCents,
      conversionFromPoints,
      conversionToMiles,
      conversionDescription,
    } = parsed.data;

    // Verify the credit card belongs to the workspace
    const card = await prisma.creditCardAccount.findFirst({
      where: { id: creditCardId, workspaceId: workspace.id },
    });

    if (!card) {
      return NextResponse.json(
        { error: "Credit card not found" },
        { status: 404 }
      );
    }

    const reward = await prisma.$transaction(async (tx) => {
      const createdReward = await tx.creditCardReward.create({
        data: {
          workspaceId: workspace.id,
          creditCardId,
          currentPoints,
          pointsValueCents,
        },
        include: { creditCard: true },
      });

      await tx.pointConversion.create({
        data: {
          workspaceId: workspace.id,
          creditCardRewardId: createdReward.id,
          fromPoints: conversionFromPoints,
          toMiles: conversionToMiles,
          conversionRate: conversionToMiles / conversionFromPoints,
          description: conversionDescription?.trim() || null,
        },
      });

      return createdReward;
    });

    return NextResponse.json(reward, { status: 201 });
  } catch (error) {
    console.error("Credit card reward create error:", error);
    return NextResponse.json(
      { error: "Failed to create credit card reward" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const parsed = UpdateCreditCardRewardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, currentPoints, pointsValueCents } = parsed.data;

    const reward = await prisma.creditCardReward.update({
      where: { id },
      data: {
        ...(currentPoints !== undefined && { currentPoints }),
        ...(pointsValueCents !== undefined && { pointsValueCents }),
        lastUpdated: new Date(),
      },
      include: { creditCard: true },
    });

    return NextResponse.json(reward);
  } catch (error) {
    console.error("Credit card reward update error:", error);
    return NextResponse.json(
      { error: "Failed to update credit card reward" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "ID is required" },
        { status: 400 }
      );
    }

    await prisma.creditCardReward.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Credit card reward delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete credit card reward" },
      { status: 500 }
    );
  }
}
