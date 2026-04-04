import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const workspaceId = 'cmmfpkqfw000ojhu89r79lbay';
  const start = Date.now();
  const created = await prisma.mileProgram.create({
    data: {
      workspaceId,
      date: new Date(),
      miles: 1,
      balanceMiles: 1,
      title: `diag-${start}`,
    },
    select: { id: true },
  });
  console.log('created', created.id);
  await prisma.mileProgram.delete({ where: { id: created.id } });
  console.log('deleted in ms', Date.now() - start);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
