"use client";

import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui-skeleton";

type TransactionLineageVersion = {
  id: string;
  version: number;
  status: "CURRENT" | "REPLACED";
  subject: string;
  amountCents: number;
  direction: "CREDIT" | "DEBIT";
  kind: string;
  date: string;
  details?: string | null;
  notes?: string | null;
  createdAt: string;
  replacedAt?: string | null;
  budget?: { id: string; name: string } | null;
  group?: { id: string; name: string; icon?: string | null } | null;
  correction?: {
    reason?: string | null;
    correctedAt: string;
    correctedBy: string;
    reversal?: {
      id: string;
      amountCents: number;
      direction: "CREDIT" | "DEBIT";
      date: string;
      postedAt: string;
    } | null;
  } | null;
};

export type TransactionLineageResponse = {
  rootTransactionId: string;
  currentTransactionId: string;
  correctionCount: number;
  truncated: boolean;
  versions: TransactionLineageVersion[];
};

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTransactionDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSignedAmount(
  version: Pick<TransactionLineageVersion, "amountCents" | "direction">,
  formatAmount: (value: number) => string,
) {
  return `${version.direction === "CREDIT" ? "+" : "−"}${formatAmount(version.amountCents)}`;
}

function describeChanges(
  previous: TransactionLineageVersion,
  current: TransactionLineageVersion,
  formatAmount: (value: number) => string,
) {
  const changes: string[] = [];
  if (previous.amountCents !== current.amountCents || previous.direction !== current.direction) {
    changes.push(`${formatSignedAmount(previous, formatAmount)} → ${formatSignedAmount(current, formatAmount)}`);
  }
  if (previous.subject !== current.subject) changes.push(`Title: “${previous.subject}” → “${current.subject}”`);
  if (previous.date !== current.date) {
    changes.push(`Date: ${formatTransactionDate(previous.date)} → ${formatTransactionDate(current.date)}`);
  }
  if (previous.budget?.id !== current.budget?.id) {
    changes.push(`Sub-account: ${previous.budget?.name ?? "None"} → ${current.budget?.name ?? "None"}`);
  }
  if (previous.group?.id !== current.group?.id) {
    changes.push(`Group: ${previous.group?.name ?? "None"} → ${current.group?.name ?? "None"}`);
  }
  if (previous.notes !== current.notes) changes.push("Notes updated");
  if (previous.details !== current.details) changes.push("Details updated");
  return changes;
}

export function TransactionLineagePanel({
  error,
  formatAmount,
  lineage,
  loading,
  onRetry,
}: Readonly<{
  error: Error | null;
  formatAmount: (value: number) => string;
  lineage: TransactionLineageResponse | null;
  loading: boolean;
  onRetry: () => void;
}>) {
  return (
    <details
      className="tx-lineage-panel modal-grid-span-2"
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        const details = event.currentTarget;
        const summary = details.querySelector<HTMLElement>(".tx-lineage-summary");
        const scrollContainer = details.closest<HTMLElement>(".txn-modal-body");
        window.requestAnimationFrame(() => {
          if (!summary || !scrollContainer) return;
          const summaryRect = summary.getBoundingClientRect();
          const containerRect = scrollContainer.getBoundingClientRect();
          scrollContainer.scrollTo({
            top: Math.max(0, scrollContainer.scrollTop + summaryRect.top - containerRect.top - 10),
            behavior: "auto",
          });
        });
      }}
    >
      <summary className="tx-lineage-summary">
        <span className="tx-lineage-summary-copy">
          <strong>Record evolution</strong>
          <small>Versions, changes, and reversals</small>
        </span>
        {lineage ? (
          <span className="tx-lineage-count">
            {lineage.correctionCount} {lineage.correctionCount === 1 ? "correction" : "corrections"}
          </span>
        ) : <span className="tx-lineage-count">View history</span>}
      </summary>

      <div className="tx-lineage-body">
        <p className="tx-lineage-intro">Immutable versions and their compensating reversals.</p>

        {loading ? <div className="tx-lineage-state"><LoadingDots /> Loading history</div> : null}
        {error ? (
          <div className="tx-lineage-state tx-lineage-error" role="alert">
            <span>{error.message || "Could not load transaction history."}</span>
            <Button type="button" className="btn btn-ghost btn-xs" onClick={onRetry}>Retry</Button>
          </div>
        ) : null}
        {lineage?.truncated ? (
          <p className="tx-lineage-warning">Only the 50 most recent versions are shown.</p>
        ) : null}

        {lineage ? (
          <ol className="tx-lineage-list">
            {lineage.versions.map((version, index) => {
              const previous = index > 0 ? lineage.versions[index - 1] : null;
              const changes = previous ? describeChanges(previous, version, formatAmount) : [];
              return (
                <Fragment key={version.id}>
                  {previous && version.correction ? (
                    <li className="tx-lineage-correction">
                      <div className="tx-lineage-connector" aria-hidden="true" />
                      <div className="tx-lineage-correction-content">
                        <div className="tx-lineage-correction-head">
                          <strong>Correction {index}</strong>
                          <span>{formatDate(version.correction.correctedAt)}</span>
                        </div>
                        {changes.length ? (
                          <ul className="tx-lineage-changes">
                            {changes.map((change) => <li key={change}>{change}</li>)}
                          </ul>
                        ) : <p className="tx-lineage-muted">No visible field changes.</p>}
                        <p className="tx-lineage-reason">
                          <strong>Reason:</strong> {version.correction.reason || "No reason provided"}
                        </p>
                        <p className="tx-lineage-meta">By {version.correction.correctedBy}</p>
                        {version.correction.reversal ? (
                          <p className="tx-lineage-reversal">
                            Compensating reversal {formatSignedAmount(version.correction.reversal, formatAmount)} posted {formatDate(version.correction.reversal.postedAt)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ) : null}
                  <li className={`tx-lineage-version ${version.status === "CURRENT" ? "is-current" : "is-replaced"}`}>
                    <div className="tx-lineage-dot" aria-hidden="true" />
                    <article className="tx-lineage-version-card">
                      <div className="tx-lineage-version-head">
                        <span>Version {version.version} · {index === 0 ? "Original" : "Replacement"}</span>
                        <span className="tx-lineage-status">{version.status === "CURRENT" ? "Current" : "Replaced"}</span>
                      </div>
                      <div className="tx-lineage-version-value">
                        <strong>{version.subject}</strong>
                        <span className={version.direction === "CREDIT" ? "positive" : "negative"}>
                          {formatSignedAmount(version, formatAmount)}
                        </span>
                      </div>
                      <p className="tx-lineage-meta">
                        {formatTransactionDate(version.date)} · {version.budget?.name ?? "No sub-account"}
                        {version.group ? ` · ${version.group.icon || "📌"} ${version.group.name}` : ""}
                      </p>
                    </article>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        ) : null}
      </div>
    </details>
  );
}
