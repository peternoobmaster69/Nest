#!/usr/bin/env tsx
/**
 * Cleanup script to remove auto-created receivables and reset credit card transactions
 * Run this before re-running the auto-accounting with the new consolidated logic
 *
 * Usage: npx tsx scripts/cleanup-auto-receivables.ts --workspace=<workspaceId>
 *        [--apply --environment=<name> --confirm=<workspaceId>]
 */

import { PrismaClient } from "@prisma/client";
import { assertMutationAllowed, auditDataScript, parseSafetyArgs } from "./data-script-safety.mjs";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const safety = parseSafetyArgs(args);
  const dryRun = !safety.apply;
  const workspaceArg = args.find((a) => a.startsWith("--workspace="));
  const workspaceId = workspaceArg ? workspaceArg.split("=")[1] : null;
  if (!workspaceId) throw new Error("--workspace=<workspaceId> is required, including for dry runs.");
  assertMutationAllowed({ safety, workspaceId, operation: "cleanup-auto-receivables" });

  console.log("=== Auto Receivables Cleanup Script ===");
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  if (workspaceId) console.log(`Workspace filter: ${workspaceId}`);
  console.log("");

  // Build where clause for auto-created receivables
  const receivableWhere = {
    title: { startsWith: "Auto: " },
    remarkTogether: { contains: "Auto-accounted by rule" },
    workspaceId,
  };

  // Find auto-created receivables
  const autoReceivables = await prisma.receivable.findMany({
    where: receivableWhere,
    select: {
      id: true,
      title: true,
      amountCents: true,
      workspaceId: true,
      remarkTogether: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5_000,
  });

  console.log(`Found ${autoReceivables.length} auto-created receivables to delete:`);
  for (const r of autoReceivables.slice(0, 10)) {
    console.log(`  - ${r.title} ($${(r.amountCents / 100).toFixed(2)}) - ${r.remarkTogether?.slice(0, 60)}...`);
  }
  if (autoReceivables.length > 10) {
    console.log(`  ... and ${autoReceivables.length - 10} more`);
  }
  console.log("");

  // Find credit card transactions that will be reset
  const cctWhere = {
    isAllocated: true,
    workspaceId,
  };

  const allocatedTxns = await prisma.creditCardTransaction.findMany({
    where: cctWhere,
    select: {
      id: true,
      subject: true,
      amountCents: true,
      workspaceId: true,
      creditCard: { select: { cardName: true } },
    },
    take: 5_000,
  });

  console.log(`Found ${allocatedTxns.length} allocated credit card transactions to reset:`);
  for (const t of allocatedTxns.slice(0, 10)) {
    console.log(`  - ${t.creditCard.cardName} | ${t.subject} ($${(t.amountCents / 100).toFixed(2)})`);
  }
  if (allocatedTxns.length > 10) {
    console.log(`  ... and ${allocatedTxns.length - 10} more`);
  }
  console.log("");

  if (dryRun) {
    console.log("DRY RUN complete. No changes made.");
    console.log(`To apply: add --apply --environment=${safety.environment} --confirm=${workspaceId}`);
    auditDataScript({ operation: "cleanup-auto-receivables", mode: "dry-run", workspaceId,
      receivables: autoReceivables.length, transactions: allocatedTxns.length });
    return;
  }

  // Confirm before proceeding
  console.log("Proceeding with cleanup...");
  console.log("");

  const applied = await prisma.$transaction(async (transaction) => {
    const deleted = autoReceivables.length
      ? await transaction.receivable.deleteMany({ where: receivableWhere })
      : { count: 0 };
    const reset = allocatedTxns.length
      ? await transaction.creditCardTransaction.updateMany({
          where: cctWhere,
          data: { isAllocated: false },
        })
      : { count: 0 };
    return { deleted: deleted.count, reset: reset.count };
  });
  console.log(`Deleted ${applied.deleted} auto-created receivables.`);
  console.log(`Reset ${applied.reset} credit card transactions to unallocated.`);

  console.log("");
  console.log("=== Cleanup complete ===");
  auditDataScript({ operation: "cleanup-auto-receivables", mode: "apply", workspaceId,
    receivables: applied.deleted, transactions: applied.reset });
  console.log("You can now re-run the auto-accounting to consolidate transactions.");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
