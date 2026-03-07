import { PageFrame } from "@/components/page-frame";
import { RewardsPage } from "@/components/rewards-page";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

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
