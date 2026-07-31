import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/contracts";
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

export async function createCioStrategyReport(params: {
  workspaceId: string;
  actorUserId: string;
  asOfDate?: string;
}) {
  const report = await buildWorkspaceCioStrategyReport({
    workspaceId: params.workspaceId,
    asOfDate: params.asOfDate,
  });
  const reportJson = JSON.stringify(report);
  const contentHash = createHash("sha256").update(reportJson).digest("hex");
  const record = await prisma.$transaction(async (tx) => {
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
  });
  return { id: record.id, report, summary: cioStrategyReportSummary(record.id, report) };
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
