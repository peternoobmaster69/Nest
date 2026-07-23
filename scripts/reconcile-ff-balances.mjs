import { PrismaClient } from "@prisma/client";
import {
  assertMutationAllowed,
  auditDataScript,
  parseSafetyArgs,
} from "./data-script-safety.mjs";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const workspaceId = positional[0];
  const frequentFlyerId = positional[1];
  if (!workspaceId || !frequentFlyerId) {
    throw new Error(
      "Usage: node scripts/reconcile-ff-balances.mjs <workspaceId> <frequentFlyerId> " +
      "[--apply --environment=<name> --confirm=<workspaceId>]",
    );
  }
  const safety = parseSafetyArgs(args);
  assertMutationAllowed({ safety, workspaceId, operation: "reconcile-ff-balances" });

  const account = await prisma.frequentFlyerAccount.findFirst({
    where: { id: frequentFlyerId, workspaceId },
    select: { id: true, programName: true },
  });
  if (!account) throw new Error("Frequent flyer account was not found in the selected workspace.");

  const programs = await prisma.mileProgram.findMany({
    where: { workspaceId, frequentFlyerId },
    select: { id: true, miles: true, balanceMiles: true },
    take: 10_000,
  });
  const detailsByProgram = await prisma.mileRedemptionDetail.groupBy({
    by: ["milesFileId"],
    where: { redemption: { workspaceId, frequentFlyerId } },
    _sum: { milesRedeemed: true },
  });
  const redeemedMap = new Map(
    detailsByProgram.map((detail) => [detail.milesFileId, detail._sum.milesRedeemed ?? 0]),
  );
  const changes = programs.flatMap((program) => {
    const expectedBalance = Math.max(program.miles - (redeemedMap.get(program.id) ?? 0), 0);
    return expectedBalance === program.balanceMiles
      ? []
      : [{ id: program.id, from: program.balanceMiles, to: expectedBalance }];
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const balanceById = new Map(changes.map((change) => [change.id, change.to]));
  const activePrograms = await prisma.mileProgram.findMany({
    where: {
      workspaceId,
      frequentFlyerId,
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    },
    select: { id: true, balanceMiles: true },
    take: 10_000,
  });
  const currentMiles = activePrograms.reduce(
    (sum, program) => sum + (balanceById.get(program.id) ?? program.balanceMiles),
    0,
  );

  if (safety.apply) {
    await prisma.$transaction(async (transaction) => {
      for (const change of changes) {
        await transaction.mileProgram.updateMany({
          where: { id: change.id, workspaceId, frequentFlyerId, balanceMiles: change.from },
          data: { balanceMiles: change.to },
        });
      }
      await transaction.frequentFlyerAccount.updateMany({
        where: { id: frequentFlyerId, workspaceId },
        data: { currentMiles },
      });
    });
  }

  auditDataScript({
    operation: "reconcile-ff-balances",
    mode: safety.apply ? "apply" : "dry-run",
    workspaceId,
    frequentFlyerId,
    programName: account.programName,
    changedPrograms: changes.length,
    currentMiles,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
