import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const workspace = await prisma.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!workspace) {
      return NextResponse.json({
        creditCards: [],
        frequentFlyers: [],
        conversions: [],
      });
    }

    const [creditCardRewards, frequentFlyers, conversions] = await Promise.all([
      prisma.creditCardReward.findMany({
        where: { workspaceId: workspace.id },
        include: { creditCard: true },
      }),
      prisma.frequentFlyerAccount.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { programName: "asc" },
      }),
      prisma.pointConversion.findMany({
        where: { workspaceId: workspace.id },
        include: {
          creditCardReward: { include: { creditCard: true } },
          frequentFlyer: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Get all credit cards that don't have rewards yet
    const allCards = await prisma.creditCardAccount.findMany({
      where: { workspaceId: workspace.id, isActive: true },
      select: { id: true, cardName: true, bankName: true, last4Digit: true },
    });

    const cardsWithRewards = new Set(creditCardRewards.map((r) => r.creditCardId));
    const cardsWithoutRewards = allCards.filter((c) => !cardsWithRewards.has(c.id));

    return NextResponse.json({
      creditCards: creditCardRewards,
      frequentFlyers,
      conversions,
      cardsWithoutRewards,
    });
  } catch (error) {
    console.error("Rewards fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch rewards data" },
      { status: 500 }
    );
  }
}
