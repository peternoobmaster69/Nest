import { prisma } from "@/lib/prisma";
import { runSecureApiRoute } from "@/lib/api-security";

const EXPORT_PAGE_SIZE = 500;

type ExportPage = {
  take: number;
  skip?: number;
  cursor?: { id: string };
};

async function collectExportRows<T extends { id: string }>(
  loadPage: (page: ExportPage) => Promise<T[]>,
) {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await loadPage({
      take: EXPORT_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...page);
    cursor = page.length === EXPORT_PAGE_SIZE ? page.at(-1)?.id : undefined;
  } while (cursor);
  return rows;
}

export async function GET(request: Request) {
  return runSecureApiRoute(request, {
    auth: { recent: true },
    noStore: true,
    errorMessage: "Failed to export account data",
  }, async ({ auth }) => {
    const userId = auth!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return Response.json({ error: "Account not found" }, { status: 404 });

    const memberships = await collectExportRows((page) => prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      take: page.take,
      skip: page.skip,
      cursor: page.cursor,
      select: { id: true, workspaceId: true, role: true, createdAt: true },
    }));
    const workspaceIds = memberships.map((membership) => membership.workspaceId);
    const scope = { workspaceId: { in: workspaceIds } };
    const pageRows = <T extends { id: string }>(
      load: (page: ExportPage) => Promise<T[]>,
    ) => collectExportRows(load);

    const [
      workspaces,
      financialAccounts,
      budgets,
      transactions,
      creditCards,
      creditCardTransactions,
      receivables,
      investmentAccounts,
      frequentFlyers,
      hotelRewards,
      creditCardRewards,
      milePrograms,
      mileRedemptionsBase,
      notes,
      notifications,
      passkeys,
      sessions,
    ] = await Promise.all([
      pageRows((page) => prisma.workspace.findMany({
        where: { id: { in: workspaceIds } }, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor,
        select: { id: true, name: true, baseCurrency: true, isShared: true, createdAt: true, updatedAt: true },
      })),
      pageRows((page) => prisma.financialAccount.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.budgetEnvelope.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.transaction.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.creditCardAccount.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.creditCardTransaction.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.receivable.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.investmentAccount.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.frequentFlyerAccount.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.hotelRewardAccount.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.creditCardReward.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.mileProgram.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.mileRedemption.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.note.findMany({ where: scope, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.inAppNotification.findMany({ where: { userId }, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor })),
      pageRows((page) => prisma.passkeyCredential.findMany({
        where: { userId }, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor,
        select: { id: true, name: true, deviceType: true, backedUp: true, transports: true, createdAt: true, lastUsedAt: true },
      })),
      pageRows((page) => prisma.loginSession.findMany({
        where: { userId }, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor,
        select: { id: true, deviceName: true, provider: true, countryCode: true, status: true, signedInAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true },
      })),
    ]);

    const investmentAccountIds = investmentAccounts.map((account) => account.id);
    const mileRedemptionIds = mileRedemptionsBase.map((redemption) => redemption.id);
    const [investmentEntries, mileRedemptionDetails] = await Promise.all([
      pageRows((page) => prisma.investmentEntry.findMany({
        where: { accountId: { in: investmentAccountIds } }, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor,
      })),
      pageRows((page) => prisma.mileRedemptionDetail.findMany({
        where: { redemptionId: { in: mileRedemptionIds } }, orderBy: { id: "asc" }, take: page.take, skip: page.skip, cursor: page.cursor,
      })),
    ]);
    const entriesByAccount = new Map<string, typeof investmentEntries>();
    for (const entry of investmentEntries) {
      const entries = entriesByAccount.get(entry.accountId) ?? [];
      entries.push(entry);
      entriesByAccount.set(entry.accountId, entries);
    }
    const detailsByRedemption = new Map<string, typeof mileRedemptionDetails>();
    for (const detail of mileRedemptionDetails) {
      const details = detailsByRedemption.get(detail.redemptionId) ?? [];
      details.push(detail);
      detailsByRedemption.set(detail.redemptionId, details);
    }
    const investments = investmentAccounts.map((account) => ({ ...account, entries: entriesByAccount.get(account.id) ?? [] }));
    const mileRedemptions = mileRedemptionsBase.map((redemption) => ({ ...redemption, details: detailsByRedemption.get(redemption.id) ?? [] }));

    const exportedAt = new Date();
    const body = JSON.stringify({
      format: "nest-account-export",
      version: 1,
      exportedAt: exportedAt.toISOString(),
      profile: user,
      memberships,
      workspaces,
      finance: {
        financialAccounts,
        budgets,
        transactions,
        creditCards,
        creditCardTransactions,
        receivables,
        investments,
        rewards: { frequentFlyers, hotelRewards, creditCardRewards, milePrograms, mileRedemptions },
      },
      notes,
      notifications,
      security: { passkeys, sessions },
    }, null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="nest-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
      },
    });
  });
}
