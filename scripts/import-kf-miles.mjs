import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_URL = "https://peter-htet.outsystemscloud.com/FM/rest/KFMiles/GetKFMiles";

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
      if (onProgress) onProgress(completed, items.length);
    }
  }

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, () => runner()));
}

async function main() {
  const workspaceId = process.argv[2];
  const apiUrl = process.argv[3] || DEFAULT_URL;
  if (!workspaceId) {
    throw new Error("Usage: node scripts/import-kf-miles.mjs <workspaceId> [apiUrl]");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  console.log(`Import start: workspace=${workspaceId}, api=${apiUrl}`);

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

  // Clear existing workspace data before import to avoid duplicates.
  const workspaceRedemptionIds = (
    await prisma.mileRedemption.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((row) => row.id);

  const workspaceMilesIds = (
    await prisma.mileProgram.findMany({
      where: { workspaceId },
      select: { id: true },
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

  console.log(
    JSON.stringify(
      {
        workspaceId,
        workspaceName: workspace.name,
        importedMiles: legacyMiles.length,
        importedRedemptions: legacyRedemptions.length,
        importedRedemptionDetails: legacyDetails.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
