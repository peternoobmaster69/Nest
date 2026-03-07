import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();

    const [creditCardRewards, frequentFlyers, conversions] = await Promise.all([
      prisma.creditCardReward.findMany({
        where: { workspaceId },
        include: { creditCard: true },
      }),
      prisma.frequentFlyerAccount.findMany({
        where: { workspaceId },
        orderBy: { programName: "asc" },
      }),
      prisma.pointConversion.findMany({
        where: { workspaceId },
        include: {
          creditCardReward: { include: { creditCard: true } },
          frequentFlyer: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const allCards = await prisma.creditCardAccount.findMany({
      where: { workspaceId, isActive: true },
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
    if (error instanceof ApiAuthError) {
      if (error.status === 404) {
        return NextResponse.json({
          creditCards: [],
          frequentFlyers: [],
          conversions: [],
          cardsWithoutRewards: [],
        });
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to fetch rewards data" }, { status: 500 });
  }
}
