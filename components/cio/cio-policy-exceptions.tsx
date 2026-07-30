import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { CioSnapshot, CioSetupSection } from "@/components/cio/types";
import { formatCioLabel, formatCioMoney, formatCioPercent } from "@/components/cio/cio-format";
import { Button } from "@/components/ui/button";

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

export function CioPolicyExceptions({
  overview,
  onConfigure,
}: {
  overview: CioSnapshot;
  onConfigure: (section: CioSetupSection) => void;
}) {
  const exceptions = [...overview.policyExceptions].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <section className="cio-card cio-exceptions-card" aria-labelledby="cio-exceptions-title">
      <header className="cio-card-header">
        <div>
          <span className="cio-card-eyebrow">Policy review</span>
          <h2 id="cio-exceptions-title">Exceptions</h2>
          <p>Deterministic checks against your confirmed limits and setup.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onConfigure("policy")}>Configure</Button>
      </header>
      {exceptions.length ? (
        <ul className="cio-exception-list">
          {exceptions.map((exception, index) => (
            <li className={`is-${exception.severity.toLowerCase()}`} key={`${exception.code}-${index}`}>
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <div className="cio-exception-heading">
                  <strong>{exception.title}</strong>
                  <span>{formatCioLabel(exception.severity)}</span>
                </div>
                <p>{exception.reviewAction}</p>
                <small>
                  Actual: {formatPolicyValue(exception.actual, overview.baseCurrency)}
                  {exception.threshold ? ` · Threshold: ${formatPolicyValue(exception.threshold, overview.baseCurrency)}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="cio-empty-inline"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>No policy exceptions</strong><p>Configured checks are currently within their limits.</p></div></div>
      )}
    </section>
  );
}

function formatPolicyValue(value: { unit: string; value: number | null }, currency: string) {
  if (value.value == null) return "not available";
  if (value.unit === "CENTS") return formatCioMoney(value.value, currency);
  if (value.unit === "BPS") return formatCioPercent(value.value);
  if (value.unit === "MONTHS") return `${value.value} months`;
  if (value.unit === "DAYS") return `${value.value} days`;
  return String(value.value);
}
