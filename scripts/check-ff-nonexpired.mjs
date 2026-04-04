import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const workspaceId = 'cmmfpkqfw000ojhu89r79lbay';
  const frequentFlyerId = 'cmmfy9mut0001jh9cead97joq';
  const today = new Date('2026-03-09T00:00:00.000Z');

  const all = await prisma.mileProgram.aggregate({
    where: { workspaceId, frequentFlyerId },
    _sum: { balanceMiles: true },
  });

  const nonExpired = await prisma.mileProgram.aggregate({
    where: {
      workspaceId,
      frequentFlyerId,
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    },
    _sum: { balanceMiles: true },
  });

  const expired = await prisma.mileProgram.aggregate({
    where: {
      workspaceId,
      frequentFlyerId,
      expiryDate: { lt: today },
    },
    _sum: { balanceMiles: true },
  });

  console.log(JSON.stringify({ all: all._sum.balanceMiles ?? 0, nonExpired: nonExpired._sum.balanceMiles ?? 0, expired: expired._sum.balanceMiles ?? 0 }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
