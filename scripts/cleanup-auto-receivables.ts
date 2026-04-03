#!/usr/bin/env tsx
/**
 * Cleanup script to remove auto-created receivables and reset credit card transactions
 * Run this before re-running the auto-accounting with the new consolidated logic
 *
 * Usage: npx tsx scripts/cleanup-auto-receivables.ts [--workspace=<workspaceId>] [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const workspaceArg = args.find((a) => a.startsWith("--workspace="));
  const workspaceId = workspaceArg ? workspaceArg.split("=")[1] : null;

  console.log("=== Auto Receivables Cleanup Script ===");
  console.log(`Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  if (workspaceId) console.log(`Workspace filter: ${workspaceId}`);
  console.log("");

  // Build where clause for auto-created receivables
  const receivableWhere = {
    title: { startsWith: "Auto: " },
    remarkTogether: { contains: "Auto-accounted by rule" },
    ...(workspaceId ? { workspaceId } : {}),
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
    ...(workspaceId ? { workspaceId } : {}),
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
    console.log("Run without --dry-run to apply changes.");
    return;
  }

  // Confirm before proceeding
  console.log("Proceeding with cleanup...");
  console.log("");

  // Delete auto-created receivables
  if (autoReceivables.length > 0) {
    const deleteResult = await prisma.receivable.deleteMany({
      where: receivableWhere,
    });
    console.log(`Deleted ${deleteResult.count} auto-created receivables.`);
  }

  // Reset credit card transactions
  if (allocatedTxns.length > 0) {
    const updateResult = await prisma.creditCardTransaction.updateMany({
      where: cctWhere,
      data: { isAllocated: false },
    });
    console.log(`Reset ${updateResult.count} credit card transactions to unallocated.`);
  }

  console.log("");
  console.log("=== Cleanup complete ===");
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
