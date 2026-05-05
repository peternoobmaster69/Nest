import { prisma } from "../lib/prisma";

async function main() {
  const directions = await prisma.transaction.groupBy({
    by: ["direction"],
    _count: true,
  });
  console.log("Direction values in database:");
  console.log(JSON.stringify(directions, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
