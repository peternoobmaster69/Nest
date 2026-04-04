import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const workspaceId = process.argv[2];
  const frequentFlyerId = process.argv[3];
  if (!workspaceId || !frequentFlyerId) {
    throw new Error('Usage: node scripts/reconcile-ff-balances.mjs <workspaceId> <frequentFlyerId>');
  }

  const programs = await prisma.mileProgram.findMany({
    where: { workspaceId, frequentFlyerId },
    select: { id: true, miles: true, balanceMiles: true },
  });

  const detailsByProgram = await prisma.mileRedemptionDetail.groupBy({
    by: ['milesFileId'],
    where: { redemption: { workspaceId, frequentFlyerId } },
    _sum: { milesRedeemed: true },
  });

  const redeemedMap = new Map(detailsByProgram.map((d) => [d.milesFileId, d._sum.milesRedeemed ?? 0]));

  let updated = 0;
  for (const program of programs) {
    const redeemed = redeemedMap.get(program.id) ?? 0;
    const expectedBalance = Math.max(program.miles - redeemed, 0);
    if (expectedBalance !== program.balanceMiles) {
      await prisma.mileProgram.update({
        where: { id: program.id },
        data: { balanceMiles: expectedBalance },
      });
      updated += 1;
    }
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const available = await prisma.mileProgram.aggregate({
    where: {
      workspaceId,
      frequentFlyerId,
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    },
    _sum: { balanceMiles: true },
  });

  const currentMiles = available._sum.balanceMiles ?? 0;

  await prisma.frequentFlyerAccount.update({
    where: { id: frequentFlyerId },
    data: { currentMiles },
  });

  console.log(JSON.stringify({ updatedPrograms: updated, currentMiles }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
