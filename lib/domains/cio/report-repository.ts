import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/contracts";
import {
  CIO_STRATEGY_REPORT_COOLDOWN_DAYS,
  cioStrategyReportNextAvailableAt,
  isCioStrategyReportOnCooldown,
} from "./report-cooldown";
import { CioStrategyReportModelSchema, type CioStrategyReportModel } from "./report-types";
import { buildWorkspaceCioStrategyReport } from "./strategy-report-service";

function parseStoredReport(value: string) {
  try {
    return CioStrategyReportModelSchema.parse(JSON.parse(value));
  } catch {
    throw new ApiRequestError(500, "The stored CIO strategy report is invalid");
  }
}

export function cioStrategyReportSummary(id: string, report: CioStrategyReportModel) {
  return {
    id,
    title: report.title,
    asOfDate: report.asOfDate,
    generatedAt: report.generatedAt,
    strategyStatus: report.strategyStatus,
    completenessBps: report.dataQuality.completenessBps,
    recommendationCount: report.recommendations.length,
    topRecommendations: report.recommendations.slice(0, 3),
  };
}

async function assertCioStrategyReportCooldown(
  db: Pick<Prisma.TransactionClient, "cioStrategyReport">,
  workspaceId: string,
  now: Date,
) {
  const latest = await db.cioStrategyReport.findFirst({
    where: { workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  if (!latest || !isCioStrategyReportOnCooldown(latest.createdAt, now)) return;

  const nextAvailableAt = cioStrategyReportNextAvailableAt(latest.createdAt);
  throw new ApiRequestError(
    409,
    `A new CIO strategy report can be generated on ${nextAvailableAt.toISOString().slice(0, 10)}, ${CIO_STRATEGY_REPORT_COOLDOWN_DAYS} days after the previous report.`,
    "CIO_STRATEGY_REPORT_COOLDOWN",
  );
}

export async function createCioStrategyReport(params: {
  workspaceId: string;
  actorUserId: string;
  asOfDate?: string;
}) {
  const generatedAt = new Date();
  await assertCioStrategyReportCooldown(prisma, params.workspaceId, generatedAt);
  const report = await buildWorkspaceCioStrategyReport({
    workspaceId: params.workspaceId,
    asOfDate: params.asOfDate,
    generatedAt,
  });
  const reportJson = JSON.stringify(report);
  const contentHash = createHash("sha256").update(reportJson).digest("hex");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const record = await prisma.$transaction(async (tx) => {
        await assertCioStrategyReportCooldown(tx, params.workspaceId, generatedAt);
        const created = await tx.cioStrategyReport.create({
          data: {
            workspaceId: params.workspaceId,
            createdByUserId: params.actorUserId,
            title: report.title,
            asOfDate: new Date(`${report.asOfDate}T00:00:00.000Z`),
            strategyStatus: report.strategyStatus,
            completenessBps: report.dataQuality.completenessBps,
            recommendationCount: report.recommendations.length,
            schemaVersion: report.schemaVersion,
            rendererVersion: report.rendererVersion,
            contentHash,
            reportJson,
          },
          select: { id: true },
        });
        await tx.workspaceAuditLog.create({
          data: {
            workspaceId: params.workspaceId,
            actorUserId: params.actorUserId,
            action: "CIO_STRATEGY_REPORT_CREATED",
            details: `CIO strategy report created for ${report.asOfDate}.`,
          },
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { id: record.id, report, summary: cioStrategyReportSummary(record.id, report) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiRequestError(409, "The strategy report generation request conflicted with another request. Try again.");
}

export async function listCioStrategyReports(workspaceId: string, take = 20) {
  const boundedTake = Math.max(1, Math.min(50, Math.trunc(take)));
  const records = await prisma.cioStrategyReport.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: boundedTake,
    select: { id: true, reportJson: true },
  });
  return records.map((record) => cioStrategyReportSummary(record.id, parseStoredReport(record.reportJson)));
}

export async function getCioStrategyReport(workspaceId: string, id: string) {
  const record = await prisma.cioStrategyReport.findFirst({
    where: { id, workspaceId },
    select: { id: true, contentHash: true, reportJson: true },
  });
  if (!record) throw new ApiRequestError(404, "CIO strategy report not found");
  return {
    id: record.id,
    contentHash: record.contentHash,
    report: parseStoredReport(record.reportJson),
  };
}
