import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { NextResponse } from "next/server";

function addMonthsUtc(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

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

    const expiringMiles = frequentFlyers.length
      ? await prisma.mileProgram.findMany({
          where: {
            workspaceId,
            frequentFlyerId: { in: frequentFlyers.map((flyer) => flyer.id) },
            balanceMiles: { gt: 0 },
            expiryDate: { gte: today },
          },
          select: {
            frequentFlyerId: true,
            balanceMiles: true,
            expiryDate: true,
          },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
        })
      : [];

    const expiryByFrequentFlyer = new Map<
      string,
      Array<{ month: string; amount: number; sortKey: string }>
    >();

    for (const entry of expiringMiles) {
      if (!entry.expiryDate || !entry.frequentFlyerId) continue;

      const year = entry.expiryDate.getUTCFullYear();
      const monthNumber = entry.expiryDate.getUTCMonth();
      const sortKey = `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
      const month = new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(entry.expiryDate);

      const grouped = expiryByFrequentFlyer.get(entry.frequentFlyerId) ?? [];
      const existing = grouped.find((item) => item.sortKey === sortKey);
      if (existing) {
        existing.amount += entry.balanceMiles;
      } else {
        grouped.push({ month, amount: entry.balanceMiles, sortKey });
      }
      expiryByFrequentFlyer.set(entry.frequentFlyerId, grouped);
    }

    const frequentFlyersWithExpiry = frequentFlyers.map((flyer) => ({
      ...flyer,
      expirySummary: (expiryByFrequentFlyer.get(flyer.id) ?? [])
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .filter(({ sortKey }) => {
          const [year, month] = sortKey.split("-").map(Number);
          const monthStart = new Date(Date.UTC(year, month - 1, 1));
          return monthStart <= addMonthsUtc(today, flyer.expiryWarning ?? 6);
        })
        .map(({ month, amount }) => ({ month, amount })),
    }));

    const allCards = await prisma.creditCardAccount.findMany({
      where: { workspaceId, isActive: true },
      select: { id: true, cardName: true, bankName: true, last4Digit: true },
    });

    const cardsWithRewards = new Set(creditCardRewards.map((r) => r.creditCardId));
    const cardsWithoutRewards = allCards.filter((c) => !cardsWithRewards.has(c.id));

    return NextResponse.json({
      creditCards: creditCardRewards,
      frequentFlyers: frequentFlyersWithExpiry,
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
