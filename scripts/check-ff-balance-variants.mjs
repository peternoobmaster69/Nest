import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function sum(where) {
  const res = await prisma.mileProgram.aggregate({ where, _sum: { balanceMiles: true } });
  return res._sum.balanceMiles ?? 0;
}

async function main() {
  const workspaceId = 'cmmfpkqfw000ojhu89r79lbay';
  const frequentFlyerId = 'cmmfy9mut0001jh9cead97joq';
  const today = new Date('2026-03-09T00:00:00.000Z');

  const base = { workspaceId, frequentFlyerId };
  const variants = {
    all: await sum(base),
    nonExpired: await sum({ ...base, OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] }),
    noFirstRedeemed: await sum({ ...base, firstRedeemedDate: null }),
    nonExpiredNoFirstRedeemed: await sum({
      ...base,
      firstRedeemedDate: null,
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    }),
    nonExpiredAndPositive: await sum({
      ...base,
      balanceMiles: { gt: 0 },
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    }),
  };

  const redemption = await prisma.mileRedemption.aggregate({ where: base, _sum: { totalMilesRedeemed: true } });
  const redeemed = redemption._sum.totalMilesRedeemed ?? 0;

  console.log(JSON.stringify({ variants, redeemed, nonExpiredMinusRedeemed: variants.nonExpired - redeemed }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
