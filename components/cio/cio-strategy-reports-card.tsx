"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CioStrategyReportSummary } from "@/components/cio/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { useWorkspaceId } from "@/components/workspace-provider";
import { apiFetch, mutationFailureMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { workspaceFetch } from "@/lib/workspace-client";

function reportDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function statusLabel(value: CioStrategyReportSummary["strategyStatus"]) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
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

export function CioStrategyReportsCard({ canEdit }: { canEdit: boolean }) {
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
    onError: (error) => toast.error(mutationFailureMessage(error)),
  });
  const download = useMutation({
    mutationFn: downloadReportPdf,
    onError: (error) => toast.error(error instanceof Error ? error.message : "The PDF could not be downloaded."),
  });
  const latest = reports.data?.[0];

  return (
    <section className="cio-card cio-reports-card" aria-labelledby="cio-strategy-reports-title">
      <div className="cio-card-header">
        <div>
          <span className="cio-card-eyebrow">Strategy documents</span>
          <h2 id="cio-strategy-reports-title">Household CIO reports</h2>
          <p>Freeze the current facts, calculations, and prioritized recommendations into a downloadable PDF.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => generate.mutate()}
          loading={generate.isPending}
          disabled={!canEdit}
          title={canEdit ? "Generate a strategy report" : "Editor access is required"}
        >
          <FileText size={16} aria-hidden="true" /> Generate report
        </Button>
      </div>

      {reports.isLoading ? <div className="cio-report-loading" role="status"><RefreshCw size={16} aria-hidden="true" /> Loading reports…</div> : null}
      {reports.isError ? (
        <div className="cio-report-error" role="alert">
          <span>The report archive could not be loaded.</span>
          <Button variant="outline" size="sm" onClick={() => void reports.refetch()}>Retry</Button>
        </div>
      ) : null}
      {!reports.isLoading && !reports.isError && !latest ? (
        <div className="cio-report-empty">
          <FileText size={22} aria-hidden="true" />
          <div><strong>No strategy report yet</strong><p>Generate one after the household profile, policy, valuations, and exposures are current.</p></div>
        </div>
      ) : null}
      {latest ? (
        <div className="cio-report-preview">
          <div className="cio-report-preview-heading">
            <div>
              <span className={`cio-report-status is-${latest.strategyStatus.toLowerCase()}`}>{statusLabel(latest.strategyStatus)}</span>
              <h3>{latest.title}</h3>
              <p>Generated {reportDate(latest.generatedAt)} · Data as at {latest.asOfDate} · {(latest.completenessBps / 100).toFixed(0)}% complete</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => download.mutate(latest)}
              loading={download.isPending && download.variables?.id === latest.id}
            >
              <Download size={15} aria-hidden="true" /> Download PDF
            </Button>
          </div>
          <ol className="cio-report-recommendations">
            {latest.topRecommendations.map((item) => (
              <li key={item.id}>
                <span>{item.priority}</span>
                <div><strong>{item.title}</strong><p>{item.action}</p></div>
              </li>
            ))}
          </ol>
          {(reports.data?.length ?? 0) > 1 ? (
            <details className="cio-report-archive">
              <summary>Previous reports ({(reports.data?.length ?? 1) - 1})</summary>
              <ul>
                {reports.data?.slice(1).map((report) => (
                  <li key={report.id}>
                    <span>{report.asOfDate} · {statusLabel(report.strategyStatus)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => download.mutate(report)}
                      loading={download.isPending && download.variables?.id === report.id}
                      aria-label={`Download ${report.title} generated ${report.generatedAt}`}
                    >
                      <Download size={14} aria-hidden="true" /> PDF
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
