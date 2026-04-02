import { PageFrame } from "@/components/page-frame";
import { RewardsPage } from "@/components/rewards-page";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

function addMonthsUtc(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export default async function RewardsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  let workspaceId: string | null = null;
  try {
    const auth = await requireWorkspaceAccess();
    workspaceId = auth.workspaceId;
  } catch (error) {
    if (!(error instanceof ApiAuthError) || error.status !== 404) {
      throw error;
    }
  }

  const creditCardsRaw = workspaceId
    ? await prisma.creditCardReward.findMany({
        where: { workspaceId },
        include: { creditCard: true },
      })
    : [];

  const frequentFlyersRaw = workspaceId
    ? await prisma.frequentFlyerAccount.findMany({
        where: { workspaceId, isActive: true },
        orderBy: { programName: "asc" },
      })
    : [];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const expiringMilesRaw = workspaceId && frequentFlyersRaw.length
    ? await prisma.mileProgram.findMany({
        where: {
          workspaceId,
          frequentFlyerId: { in: frequentFlyersRaw.map((ff) => ff.id) },
          balanceMiles: { gt: 0 },
          expiryDate: { gte: today },
        },
        select: {
          frequentFlyerId: true,
          balanceMiles: true,
          expiryDate: true,
        },
      })
    : [];

  const availableCards = workspaceId
    ? await prisma.creditCardAccount.findMany({
        where: { workspaceId, isActive: true, reward: null },
        select: { id: true, cardName: true, bankName: true, last4Digit: true },
      })
    : [];

  const conversionsRaw = workspaceId
    ? await prisma.pointConversion.findMany({
        where: { workspaceId },
        include: {
          creditCardReward: { include: { creditCard: true } },
          frequentFlyer: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const creditCards = creditCardsRaw.map((card) => ({
    ...card,
    lastUpdated: card.lastUpdated.toISOString(),
    creditCard: {
      ...card.creditCard,
      createdAt: card.creditCard.createdAt.toISOString(),
      updatedAt: card.creditCard.updatedAt.toISOString(),
    },
  }));

  const frequentFlyers = frequentFlyersRaw.map((ff) => {
    const groupedMonths = expiringMilesRaw
      .filter((entry) => entry.frequentFlyerId === ff.id && entry.expiryDate)
      .reduce<Array<{ month: string; amount: number; sortKey: string }>>((acc, entry) => {
        if (!entry.expiryDate) return acc;
        const year = entry.expiryDate.getUTCFullYear();
        const monthNumber = entry.expiryDate.getUTCMonth();
        const sortKey = `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
        const month = new Intl.DateTimeFormat("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(entry.expiryDate);
        const existing = acc.find((item) => item.sortKey === sortKey);
        if (existing) {
          existing.amount += entry.balanceMiles;
        } else {
          acc.push({ month, amount: entry.balanceMiles, sortKey });
        }
        return acc;
      }, []);

    return {
      ...ff,
      expiryWarning: ff.expiryWarning ?? 6,
      expirySummary: groupedMonths
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .filter(({ sortKey }) => {
          const [year, month] = sortKey.split("-").map(Number);
          const monthStart = new Date(Date.UTC(year, month - 1, 1));
          return monthStart <= addMonthsUtc(today, ff.expiryWarning ?? 6);
        })
        .map(({ month, amount }) => ({ month, amount })),
      createdAt: ff.createdAt.toISOString(),
      updatedAt: ff.updatedAt.toISOString(),
    };
  });

  const conversions = conversionsRaw.map((conversion) => ({
    ...conversion,
    createdAt: conversion.createdAt.toISOString(),
  }));

  return (
    <PageFrame
      title="Rewards & Miles"
      current="/rewards"
      userName={userName}
      userImage={session.user?.image || null}
      badgeCounts={{
        budgets: creditCards.length + frequentFlyers.length,
      }}
    >
      <RewardsPage
        initialCreditCards={creditCards}
        initialFrequentFlyers={frequentFlyers}
        initialConversions={conversions}
        availableCards={availableCards}
      />
    </PageFrame>
  );
}
