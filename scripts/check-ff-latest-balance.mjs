import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const workspaceId = 'cmmfpkqfw000ojhu89r79lbay';
  const frequentFlyerId = 'cmmfy9mut0001jh9cead97joq';

  const rows = await prisma.mileProgram.findMany({
    where: { workspaceId, frequentFlyerId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 10,
    select: { id: true, date: true, title: true, miles: true, balanceMiles: true, expiryDate: true },
  });

  const minDate = await prisma.mileProgram.findFirst({
    where: { workspaceId, frequentFlyerId },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, date: true, title: true, miles: true, balanceMiles: true },
  });

  const maxBalance = await prisma.mileProgram.findFirst({
    where: { workspaceId, frequentFlyerId },
    orderBy: { balanceMiles: 'desc' },
    select: { id: true, date: true, title: true, miles: true, balanceMiles: true },
  });

  console.log(JSON.stringify({ latest10: rows, earliest: minDate, maxBalance }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
