import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const workspaceId = 'cmmfpkqfw000ojhu89r79lbay';
  const frequentFlyerId = 'cmmfy9mut0001jh9cead97joq';

  const [ff, sums, redemptionSum, counts] = await Promise.all([
    prisma.frequentFlyerAccount.findUnique({ where: { id: frequentFlyerId }, select: { id: true, programName: true, accountNumber: true, currentMiles: true } }),
    prisma.mileProgram.aggregate({ where: { workspaceId, frequentFlyerId }, _sum: { miles: true, balanceMiles: true } }),
    prisma.mileRedemption.aggregate({ where: { workspaceId, frequentFlyerId }, _sum: { totalMilesRedeemed: true } }),
    Promise.all([
      prisma.mileProgram.count({ where: { workspaceId, frequentFlyerId } }),
      prisma.mileRedemption.count({ where: { workspaceId, frequentFlyerId } }),
      prisma.mileRedemptionDetail.count({ where: { redemption: { workspaceId, frequentFlyerId } } }),
    ]),
  ]);

  const detailSum = await prisma.mileRedemptionDetail.aggregate({
    where: { redemption: { workspaceId, frequentFlyerId } },
    _sum: { milesRedeemed: true },
  });

  console.log(JSON.stringify({
    ff,
    mileProgramSumMiles: sums._sum.miles ?? 0,
    mileProgramSumBalance: sums._sum.balanceMiles ?? 0,
    redemptionTotalMiles: redemptionSum._sum.totalMilesRedeemed ?? 0,
    redemptionDetailMiles: detailSum._sum.milesRedeemed ?? 0,
    counts: { milePrograms: counts[0], redemptions: counts[1], details: counts[2] },
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
