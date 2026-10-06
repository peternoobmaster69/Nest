"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CioStrategyReportSummary } from "@/components/cio/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { useWorkspaceId } from "@/components/workspace-provider";
import { ApiClientError, apiFetch, mutationFailureMessage } from "@/lib/api/client";
import {
  cioStrategyReportNextAvailableAt,
  isCioStrategyReportOnCooldown,
} from "@/lib/domains/cio/report-cooldown";
import { queryKeys } from "@/lib/query-keys";
import { workspaceFetch } from "@/lib/workspace-client";

function reportDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function reportDay(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { dateStyle: "medium" }).format(parsed);
}

function statusLabel(value: CioStrategyReportSummary["strategyStatus"]) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function recommendationCategoryLabel(value: CioStrategyReportSummary["topRecommendations"][number]["category"]) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function recommendationStateLabel(value: CioStrategyReportSummary["topRecommendations"][number]["severity"]) {
  if (value === "CRITICAL") return "Act now";
  if (value === "HIGH") return "Prioritize";
  if (value === "MEDIUM") return "Review";
  return "On track";
}

async function downloadReportPdf(report: CioStrategyReportSummary) {
  const response = await workspaceFetch(`/api/cio/reports/${encodeURIComponent(report.id)}/pdf`, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : `PDF download failed (${response.status}).`);
  }
  const disposition = response.headers.get("content-disposition");
  const filename = disposition?.match(/filename="([^"]+)"/i)?.[1] ?? `CIO-Strategy-${report.asOfDate}.pdf`;
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function StrategyReportSnapshot({ report, latest, downloading, onDownload }: Readonly<{
  report: CioStrategyReportSummary;
  latest: boolean;
  downloading: boolean;
  onDownload: () => void;
}>) {
  const headingId = `cio-report-snapshot-${report.id}`;
  return (
    <article className={`cio-report-snapshot${latest ? " is-latest" : ""}`} aria-labelledby={headingId}>
      <header className="cio-report-snapshot-heading">
        <div>
          <div className="cio-report-snapshot-labels">
            <span className="cio-report-snapshot-label">{latest ? "Latest snapshot" : "Earlier snapshot"}</span>
            <span className={`cio-report-status is-${report.strategyStatus.toLowerCase()}`}>{statusLabel(report.strategyStatus)}</span>
          </div>
          <h3 id={headingId}>{report.title}</h3>
          <dl className="cio-report-snapshot-facts">
            <div><dt>Generated</dt><dd>{reportDate(report.generatedAt)}</dd></div>
            <div><dt>Data date</dt><dd>{report.asOfDate}</dd></div>
            <div><dt>Completeness</dt><dd>{(report.completenessBps / 100).toFixed(0)}%</dd></div>
          </dl>
        </div>
        <Button variant="outline" size="sm" onClick={onDownload} loading={downloading}>
          <Download size={15} aria-hidden="true" /> Download PDF
        </Button>
      </header>
      <section className="cio-report-snapshot-recommendations" aria-label={`Recommendations recorded in ${report.title}`}>
        <h4>Recorded recommendations</h4>
        {report.topRecommendations.length ? (
          <ul className="cio-report-recommendations">
            {report.topRecommendations.map((item) => (
              <li key={item.id}>
                <div className="cio-report-recommendation-meta">
                  <span className="cio-report-recommendation-category">{recommendationCategoryLabel(item.category)}</span>
                  <span className={`cio-report-recommendation-state is-${item.severity.toLowerCase()}`}>{recommendationStateLabel(item.severity)}</span>
                </div>
                <div className="cio-report-recommendation-copy"><strong>{item.title}</strong><p>{item.action}</p></div>
              </li>
            ))}
          </ul>
        ) : <p className="cio-report-snapshot-no-recommendations">No recommendations were recorded in this snapshot.</p>}
      </section>
    </article>
  );
}

export function CioStrategyReportsCard({ canEdit }: Readonly<{ canEdit: boolean }>) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const reports = useQuery({
    queryKey: queryKeys.cioReports(workspaceId),
    queryFn: async () => (await apiFetch<{ reports: CioStrategyReportSummary[] }>("/api/cio/reports", { cache: "no-store" })).reports,
    enabled: Boolean(workspaceId),
  });
  const generate = useMutation({
    mutationFn: async () => (await apiFetch<{ report: CioStrategyReportSummary }>("/api/cio/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })).report,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cioReports(workspaceId) });
      toast.success("CIO strategy report generated.");
    },
    onError: (error) => toast.error(
      error instanceof ApiClientError && error.code === "CIO_STRATEGY_REPORT_COOLDOWN"
        ? error.message
        : mutationFailureMessage(error),
    ),
  });
  const download = useMutation({
    mutationFn: downloadReportPdf,
    onError: (error) => toast.error(error instanceof Error ? error.message : "The PDF could not be downloaded."),
  });
  const latest = reports.data?.[0];
  const cooldownEndsAt = latest ? cioStrategyReportNextAvailableAt(latest.generatedAt) : null;
  const reportOnCooldown = latest ? isCioStrategyReportOnCooldown(latest.generatedAt) : false;
  const canGenerate = canEdit && !reportOnCooldown;
  const generateTitle = !canEdit
    ? "Editor access is required"
    : reportOnCooldown && cooldownEndsAt
      ? `The next report can be generated on ${reportDate(cooldownEndsAt.toISOString())}.`
      : "Generate a strategy report";

  return (
    <section className="cio-card cio-reports-card" aria-labelledby="cio-strategy-reports-title">
      <div className="cio-card-header">
        <div>
          <span className="cio-card-eyebrow">Strategy documents</span>
          <h2 id="cio-strategy-reports-title">Household CIO reports</h2>
          <p>Each box is an immutable snapshot of the facts, calculations, and recommendations recorded when that report was generated.</p>
        </div>
        <div className="cio-report-generate-action">
          <Button variant="primary" onClick={() => generate.mutate()} loading={generate.isPending} disabled={!canGenerate} title={generateTitle}>
            <FileText size={16} aria-hidden="true" /> Generate report
          </Button>
          {reportOnCooldown && cooldownEndsAt ? (
            <span>Next report {reportDay(cooldownEndsAt.toISOString())}</span>
          ) : null}
        </div>
      </div>

      {reports.isLoading ? <div className="cio-report-loading" role="status"><RefreshCw size={16} aria-hidden="true" /> Loading reports…</div> : null}
      {reports.isError ? <div className="cio-report-error" role="alert"><span>The report archive could not be loaded.</span><Button variant="outline" size="sm" onClick={() => void reports.refetch()}>Retry</Button></div> : null}
      {!reports.isLoading && !reports.isError && !latest ? <div className="cio-report-empty"><FileText size={22} aria-hidden="true" /><div><strong>No strategy report yet</strong><p>Generate one after the household profile, policy, valuations, and exposures are current.</p></div></div> : null}
      {latest ? (
        <div className="cio-report-snapshot-list" aria-label="Strategy report snapshots">
          {reports.data?.map((report, index) => (
            <StrategyReportSnapshot key={report.id} report={report} latest={index === 0} downloading={download.isPending && download.variables?.id === report.id} onDownload={() => download.mutate(report)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
