import { PageFrame } from "@/components/page-frame";
import { RewardsPage } from "@/components/rewards-page";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";

export default async function RewardsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";

  const workspace = await prisma.workspace.findFirst({
    orderBy: { createdAt: "asc" },
  });

  const creditCardsRaw = workspace
    ? await prisma.creditCardReward.findMany({
        where: { workspaceId: workspace.id },
        include: { creditCard: true },
      })
    : [];

  const frequentFlyersRaw = workspace
    ? await prisma.frequentFlyerAccount.findMany({
        where: { workspaceId: workspace.id, isActive: true },
        orderBy: { programName: "asc" },
      })
    : [];

  const availableCards = workspace
    ? await prisma.creditCardAccount.findMany({
        where: { workspaceId: workspace.id, isActive: true, reward: null },
        select: { id: true, cardName: true, bankName: true, last4Digit: true },
      })
    : [];

  const conversionsRaw = workspace
    ? await prisma.pointConversion.findMany({
        where: { workspaceId: workspace.id },
        include: {
          creditCardReward: { include: { creditCard: true } },
          frequentFlyer: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Serialize dates for client components
  const creditCards = creditCardsRaw.map((card) => ({
    ...card,
    lastUpdated: card.lastUpdated.toISOString(),
    creditCard: {
      ...card.creditCard,
      createdAt: card.creditCard.createdAt.toISOString(),
      updatedAt: card.creditCard.updatedAt.toISOString(),
    },
  }));

  const frequentFlyers = frequentFlyersRaw.map((ff) => ({
    ...ff,
    expiryWarning: ff.expiryWarning ?? 6,
    createdAt: ff.createdAt.toISOString(),
    updatedAt: ff.updatedAt.toISOString(),
  }));

  const conversions = conversionsRaw.map((conversion) => ({
    ...conversion,
    createdAt: conversion.createdAt.toISOString(),
  }));

  return (
    <PageFrame
      title="Rewards & Miles"
      current="/rewards"
      userName={userName}
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
