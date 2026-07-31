import { AlertTriangle, CheckCircle2, ChevronDown, Clock3 } from "lucide-react";
import type { CioSnapshot, CioSetupSection } from "@/components/cio/types";
import { formatCioDate, formatCioMoney } from "@/components/cio/cio-format";
import { Button } from "@/components/ui/button";

export function CioHealthSummary({
  overview,
  onConfigure,
  onOpenBankControls,
  onOpenSubAccounts,
}: {
  overview: CioSnapshot;
  onConfigure: (section: CioSetupSection) => void;
  onOpenBankControls: () => void;
  onOpenSubAccounts: () => void;
}) {
  const { dataQuality, totals, baseCurrency } = overview;
  const criticalCount = dataQuality.warnings.filter((warning) => warning.severity === "CRITICAL").length;
  const statusLabel = criticalCount > 0 ? "Action required" : dataQuality.warnings.length ? "Review recommended" : "Ready";
  const statusTone = criticalCount ? "critical" : dataQuality.warnings.length ? "warning" : "good";
  const issueLabel = dataQuality.warnings.length === 1 ? "1 issue" : `${dataQuality.warnings.length} issues`;

  return (
    <>
      <details className={`cio-health-card is-${statusTone}`}>
        <summary className="cio-health-summary-row">
          <div className={`cio-health-icon is-${statusTone}`} aria-hidden="true">
            {criticalCount ? <AlertTriangle size={22} /> : dataQuality.warnings.length ? <Clock3 size={22} /> : <CheckCircle2 size={22} />}
          </div>
          <div className="cio-health-heading">
            <span className="cio-card-eyebrow">Decision readiness</span>
            <h2 id="cio-health-title">{statusLabel}</h2>
          </div>
          <div className="cio-health-meta">
            <span><strong>{dataQuality.completenessPercentage}%</strong> complete</span>
            <span>Valuations through {formatCioDate(dataQuality.latestValuationDate)}</span>
          </div>
          <span className={`cio-health-issue-count is-${statusTone}`}>{issueLabel}</span>
          <ChevronDown className="cio-health-chevron" size={18} aria-hidden="true" />
        </summary>
        <div className="cio-health-details" aria-labelledby="cio-health-title">
          <div className="cio-completeness">
            <div className="cio-completeness-copy"><span>Data completeness</span><strong>{dataQuality.completenessPercentage}%</strong></div>
            <div className="cio-progress-track" role="progressbar" aria-label="CIO data completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dataQuality.completenessPercentage}>
              <span style={{ width: `${Math.min(100, Math.max(0, dataQuality.completenessPercentage))}%` }} />
            </div>
            <small>Latest valuation: {formatCioDate(dataQuality.latestValuationDate)} · Oldest valuation: {formatCioDate(dataQuality.oldestValuationDate)}</small>
          </div>
        </div>
      </details>

      <section className="cio-metric-grid" aria-label="CIO portfolio metrics">
        <Metric label="Financial assets" value={formatCioMoney(totals.financialAssetsCents, baseCurrency)} hint="Savings sub-accounts and investments" />
        <Metric label="Savings sub-accounts" value={formatCioMoney(totals.savingsSubAccountCents, baseCurrency)} hint="Only sub-accounts marked as savings" />
        <Metric label="Investable assets" value={formatCioMoney(totals.investableAssetsCents, baseCurrency)} hint="Included in allocation analysis" />
        <Metric label="Retirement included" value={formatCioMoney(totals.retirementIncludedAssetsCents, baseCurrency)} hint="Starting projection balance" />
        <Metric label="Planning liabilities" value={formatCioMoney(totals.planningLiabilitiesCents, baseCurrency)} hint="Separate from dashboard net worth" tone={totals.planningLiabilitiesCents > 0 ? "warning" : "normal"} />
      </section>

      {dataQuality.warnings.length ? (
        <section className="cio-setup-actions" aria-labelledby="cio-setup-actions-title">
          <div>
            <span className="cio-card-eyebrow">Setup actions</span>
            <h2 id="cio-setup-actions-title">Improve decision quality</h2>
          </div>
          <ul>
            {dataQuality.warnings.slice(0, 4).map((warning, index) => {
              const section = sectionForWarning(warning.code);
              const reviewsBankControls = warning.code === "BANK_BALANCE_AFTER_DATA_DATE";
              const reviewsSubAccounts = warning.code === "SAVINGS_BALANCE_AFTER_DATA_DATE";
              return (
                <li key={`${warning.code}-${warning.entityId ?? "workspace"}-${index}`}>
                  <span className={`cio-severity-dot is-${warning.severity.toLowerCase()}`} aria-hidden="true" />
                  <span><strong>{warning.message}</strong><small>{warning.severity.toLowerCase()} · setup data, not investment advice</small></span>
                  <Button variant="outline" size="sm" onClick={reviewsBankControls ? onOpenBankControls : reviewsSubAccounts ? onOpenSubAccounts : () => onConfigure(section)}>
                    {reviewsBankControls ? "Open bank controls" : reviewsSubAccounts ? "Open sub-accounts" : "Review"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Metric({ label, value, hint, tone = "normal" }: { label: string; value: string; hint: string; tone?: "normal" | "warning" }) {
  return (
    <article className={`cio-metric-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function sectionForWarning(code: CioSnapshot["dataQuality"]["warnings"][number]["code"]): CioSetupSection {
  if (code === "MISSING_PROFILE") return "profile";
  if (code === "MISSING_POLICY") return "policy";
  if (code === "POSSIBLE_DUPLICATE") return "positions";
  return "investments";
}
