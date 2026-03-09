import { prisma } from "../lib/prisma";

const DEFAULT_URL = "https://peter-htet.outsystemscloud.com/FM/rest/KFMiles/GetKFMiles";
const LEGACY_SYSTEM = "LEGACY_KFMILES_V1";

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function upsertLinkedRecord({
  sourceTable,
  sourceId,
  targetModel,
  create,
  update,
}) {
  const link = await prisma.legacyRecordLink.findUnique({
    where: {
      system_sourceTable_sourceId: {
        system: LEGACY_SYSTEM,
        sourceTable,
        sourceId,
      },
    },
    select: { id: true, targetId: true },
  });

  if (link) {
    await update(link.targetId);
    return link.targetId;
  }

  const targetId = await create();
  await prisma.legacyRecordLink.create({
    data: {
      system: LEGACY_SYSTEM,
      sourceTable,
      sourceId,
      targetModel,
      targetId,
    },
  });
  return targetId;
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

  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch legacy API (${res.status})`);
  }

  const payload = await res.json();
  const legacyMiles = Array.isArray(payload?.KFMiles) ? payload.KFMiles : [];
  const legacyRedemptions = Array.isArray(payload?.KFMilesRed) ? payload.KFMilesRed : [];
  const legacyDetails = Array.isArray(payload?.KFMilesRedDet) ? payload.KFMilesRedDet : [];

  let milesUpserts = 0;
  let redemptionUpserts = 0;
  let detailUpserts = 0;
  let detailSkipped = 0;

  for (const row of legacyMiles) {
    const sourceId = String(row.Id);
    await upsertLinkedRecord({
      sourceTable: "KFMiles",
      sourceId,
      targetModel: "MileProgram",
      create: async () => {
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
        return created.id;
      },
      update: async (targetId) => {
        await prisma.mileProgram.update({
          where: { id: targetId },
          data: {
            workspaceId,
            date: toDate(row.Date) ?? new Date(),
            miles: Number(row.Miles ?? 0),
            balanceMiles: Number(row.BalanceMiles ?? row.Miles ?? 0),
            expiryDate: toDate(row.ExpiryDate),
            title: row.Title ?? null,
            firstRedeemedDate: toDate(row.FirstRedeemedDate),
          },
        });
      },
    });
    milesUpserts += 1;
  }

  for (const row of legacyRedemptions) {
    const sourceId = String(row.Id);
    await upsertLinkedRecord({
      sourceTable: "KFMilesRedemption",
      sourceId,
      targetModel: "MileRedemption",
      create: async () => {
        const created = await prisma.mileRedemption.create({
          data: {
            workspaceId,
            redemptionTitle: row.RemeptionTitle ?? "Legacy Redemption",
            totalMilesRedeemed: Number(row.TotalMilesRedeemed ?? 0),
            dateTime: toDate(row.DateTime) ?? new Date(),
          },
          select: { id: true },
        });
        return created.id;
      },
      update: async (targetId) => {
        await prisma.mileRedemption.update({
          where: { id: targetId },
          data: {
            workspaceId,
            redemptionTitle: row.RemeptionTitle ?? "Legacy Redemption",
            totalMilesRedeemed: Number(row.TotalMilesRedeemed ?? 0),
            dateTime: toDate(row.DateTime) ?? new Date(),
          },
        });
      },
    });
    redemptionUpserts += 1;
  }

  for (const row of legacyDetails) {
    const sourceId = String(row.Id);
    const redemptionSourceId = String(row.KFMilesRedemptionId);
    const milesSourceId = String(row.KFMilesId);

    const [redemptionLink, milesLink] = await Promise.all([
      prisma.legacyRecordLink.findUnique({
        where: {
          system_sourceTable_sourceId: {
            system: LEGACY_SYSTEM,
            sourceTable: "KFMilesRedemption",
            sourceId: redemptionSourceId,
          },
        },
        select: { targetId: true },
      }),
      prisma.legacyRecordLink.findUnique({
        where: {
          system_sourceTable_sourceId: {
            system: LEGACY_SYSTEM,
            sourceTable: "KFMiles",
            sourceId: milesSourceId,
          },
        },
        select: { targetId: true },
      }),
    ]);

    if (!redemptionLink?.targetId || !milesLink?.targetId) {
      detailSkipped += 1;
      continue;
    }

    await upsertLinkedRecord({
      sourceTable: "KFMilesRedemptionDetail",
      sourceId,
      targetModel: "MileRedemptionDetail",
      create: async () => {
        const created = await prisma.mileRedemptionDetail.create({
          data: {
            redemptionId: redemptionLink.targetId,
            milesFileId: milesLink.targetId,
            milesRedeemed: Number(row.MilesRedeemed ?? 0),
          },
          select: { id: true },
        });
        return created.id;
      },
      update: async (targetId) => {
        await prisma.mileRedemptionDetail.update({
          where: { id: targetId },
          data: {
            redemptionId: redemptionLink.targetId,
            milesFileId: milesLink.targetId,
            milesRedeemed: Number(row.MilesRedeemed ?? 0),
          },
        });
      },
    });
    detailUpserts += 1;
  }

  console.log(
    JSON.stringify(
      {
        workspaceId,
        workspaceName: workspace.name,
        milesUpserts,
        redemptionUpserts,
        detailUpserts,
        detailSkipped,
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
