import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatCioDate, formatCioMoney, formatCioPercent } from "@/components/cio/cio-format";
import type { CioSnapshot } from "@/components/cio/types";

export function CioContributionProgressCard({ overview }: { overview: CioSnapshot }) {
  const progress = overview.contributionProgress;
  if (!progress) return null;

  const onTrack = progress.status === "ON_TRACK";
  const paceAmount = Math.abs(progress.paceGapCents);
  const progressPercentage = Math.min(100, progress.annualProgressBps / 100);
  const sourceLabel = progress.targetSource === "OVERRIDE"
    ? "configured annual target"
    : "retirement-eligible recurring flows";

  return (
    <section className={`cio-card cio-contribution-card is-${onTrack ? "on-track" : "behind"}`} aria-labelledby="cio-contribution-title">
      <div className="cio-contribution-heading">
        <div>
          <span className="cio-card-eyebrow">{progress.year} contribution pace</span>
          <h2 id="cio-contribution-title">{onTrack ? `On track for ${progress.year}` : `Behind ${progress.year} pace`}</h2>
          <p>
            {formatCioMoney(paceAmount, overview.baseCurrency)} {onTrack ? "ahead of" : "behind"} the expected pace as of {formatCioDate(overview.asOfDate)}.
          </p>
        </div>
        <span className={`cio-contribution-status is-${onTrack ? "on-track" : "behind"}`}>
          {onTrack ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertTriangle size={17} aria-hidden="true" />}
          {onTrack ? "On track" : "Behind plan"}
        </span>
      </div>

      <dl className="cio-contribution-facts">
        <div><dt>Recorded invested change YTD</dt><dd>{formatCioMoney(progress.actualYtdCents, overview.baseCurrency)}</dd></div>
        <div><dt>Expected by today</dt><dd>{formatCioMoney(progress.expectedToDateCents, overview.baseCurrency)}</dd></div>
        <div><dt>Annual target</dt><dd>{formatCioMoney(progress.annualTargetCents, overview.baseCurrency)}</dd></div>
      </dl>

      <div
        className="cio-contribution-progress-track"
        role="progressbar"
        aria-label={`${progress.year} annual contribution progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPercentage)}
      >
        <span style={{ width: `${progressPercentage}%` }} />
        <i style={{ left: `${Math.min(100, progress.calendarProgressBps / 100)}%` }} aria-hidden="true" />
      </div>
      <div className="cio-contribution-meta">
        <span>{formatCioPercent(progress.annualProgressBps)} of annual target recorded</span>
        <span>{formatCioPercent(progress.contributionGrowthRateBps)} annual growth assumption · {sourceLabel}</span>
      </div>
    </section>
  );
}
