import { PrismaClient } from "@prisma/client";
import {
  assertMutationAllowed,
  auditDataScript,
  parseSafetyArgs,
} from "./data-script-safety.mjs";

const prisma = new PrismaClient();

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeUrlLabel(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Legacy API URL must not contain credentials.");
  return `${url.origin}${url.pathname}`;
}

async function runWithConcurrency(items, limit, worker, onProgress) {
  let nextIndex = 0;
  let completed = 0;

  async function runner() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
      completed += 1;
      onProgress(completed, items.length);
    }
  }

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, () => runner()));
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const workspaceId = positional[0];
  const apiUrl = positional[1];
  if (!workspaceId || !apiUrl) {
    throw new Error(
      "Usage: node scripts/import-kf-miles.mjs <workspaceId> <apiUrl> " +
      "[--apply --environment=<name> --confirm=<workspaceId>]",
    );
  }
  const safety = parseSafetyArgs(args);
  assertMutationAllowed({ safety, workspaceId, operation: "import-kf-miles" });
  const apiLabel = safeUrlLabel(apiUrl);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  console.log(`Import start: workspace=${workspaceId}, api=${apiLabel}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  const res = await fetch(apiUrl, { signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch legacy API (${res.status})`);
  }
  const payload = await res.json();
  console.log("Fetched legacy payload");

  const legacyMiles = Array.isArray(payload?.KFMiles) ? payload.KFMiles : [];
  const legacyRedemptions = Array.isArray(payload?.KFMilesRed) ? payload.KFMilesRed : [];
  const legacyDetails = Array.isArray(payload?.KFMilesRedDet) ? payload.KFMilesRedDet : [];
  console.log(
    `Parsed payload: miles=${legacyMiles.length}, redemptions=${legacyRedemptions.length}, details=${legacyDetails.length}`,
  );
  if ([legacyMiles, legacyRedemptions, legacyDetails].some((rows) => rows.length > 10_000)) {
    throw new Error("Legacy import collections are limited to 10,000 rows each.");
  }
  if (!safety.apply) {
    auditDataScript({
      operation: "import-kf-miles",
      mode: "dry-run",
      workspaceId,
      apiUrl: apiLabel,
      miles: legacyMiles.length,
      redemptions: legacyRedemptions.length,
      redemptionDetails: legacyDetails.length,
    });
    return;
  }

  // Clear existing workspace data before import to avoid duplicates.
  const workspaceRedemptionIds = (
    await prisma.mileRedemption.findMany({
      where: { workspaceId },
      select: { id: true },
      take: 10_000,
    })
  ).map((row) => row.id);

  const workspaceMilesIds = (
    await prisma.mileProgram.findMany({
      where: { workspaceId },
      select: { id: true },
      take: 10_000,
    })
  ).map((row) => row.id);

  if (workspaceRedemptionIds.length > 0) {
    console.log(`Clearing existing redemptions: ${workspaceRedemptionIds.length}`);
    await prisma.mileRedemptionDetail.deleteMany({
      where: { redemptionId: { in: workspaceRedemptionIds } },
    });
    await prisma.mileRedemption.deleteMany({
      where: { id: { in: workspaceRedemptionIds } },
    });
  }

  if (workspaceMilesIds.length > 0) {
    console.log(`Clearing existing miles programs: ${workspaceMilesIds.length}`);
    await prisma.mileRedemptionDetail.deleteMany({
      where: { milesFileId: { in: workspaceMilesIds } },
    });
    await prisma.mileProgram.deleteMany({
      where: { id: { in: workspaceMilesIds } },
    });
  }

  const milesIdMap = new Map();
  console.log("Importing mile programs...");
  await runWithConcurrency(
    legacyMiles,
    12,
    async (row) => {
      const created = await prisma.mileProgram.create({
        data: {
          workspaceId,
          date: toDate(row.Date) ?? new Date(),
          miles: Number(row.Miles ?? 0),
          balanceMiles: Number(row.BalanceMiles ?? row.Miles ?? 0),
          expiryDate: toDate(row.ExpiryDate),
          title: row.Title ?? null,
          firstRedeemedDate: toDate(row.FirstRedeemedDate),
        },
        select: { id: true },
      });
      milesIdMap.set(String(row.Id), created.id);
    },
    (done, total) => {
      if (done % 25 === 0 || done === total) {
        console.log(`Mile programs imported: ${done}/${total}`);
      }
    },
  );

  const redemptionIdMap = new Map();
  console.log("Importing redemptions...");
  for (const row of legacyRedemptions) {
    const created = await prisma.mileRedemption.create({
      data: {
        workspaceId,
        redemptionTitle: row.RemeptionTitle ?? "Legacy Redemption",
        totalMilesRedeemed: Number(row.TotalMilesRedeemed ?? 0),
        dateTime: toDate(row.DateTime) ?? new Date(),
      },
      select: { id: true },
    });
    redemptionIdMap.set(String(row.Id), created.id);
  }

  console.log("Importing redemption details...");
  await runWithConcurrency(
    legacyDetails,
    12,
    async (row) => {
      const redemptionId = redemptionIdMap.get(String(row.KFMilesRedemptionId));
      const milesFileId = milesIdMap.get(String(row.KFMilesId));
      if (!redemptionId || !milesFileId) return;

      await prisma.mileRedemptionDetail.create({
        data: {
          redemptionId,
          milesFileId,
          milesRedeemed: Number(row.MilesRedeemed ?? 0),
        },
      });
    },
    (done, total) => {
      if (done % 20 === 0 || done === total) {
        console.log(`Redemption details imported: ${done}/${total}`);
      }
    },
  );

  auditDataScript({
    operation: "import-kf-miles",
    mode: "apply",
    workspaceId,
    workspaceName: workspace.name,
    importedMiles: legacyMiles.length,
    importedRedemptions: legacyRedemptions.length,
    importedRedemptionDetails: legacyDetails.length,
  });
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
