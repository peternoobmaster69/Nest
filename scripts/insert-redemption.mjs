import { PrismaClient } from "@prisma/client";

  const prisma = new PrismaClient();

  await prisma.mileRedemption.create({
    data: {
      workspaceId: "cmmfpkqfw000ojhu89r79lbay",
      frequentFlyerId: "cmmfy9mut0001jh9cead97joq",
      redemptionTitle: "Singapore - Perth",
      totalMilesRedeemed: 292000,
      dateTime: '2023-04-13T14:30:00.000Z',
    },
  });

  await prisma.$disconnect();