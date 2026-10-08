"use client";

import { useState } from "react";
import type { CioRetirementScenario, CioRetirementScenarioName } from "@/lib/domains/cio/types";
import { isPrivacyModeOn, MASKED_AMOUNT } from "@/lib/privacy-mode";
import { formatCioDate, formatCioLabel, formatCioMoney, formatCioPercent } from "@/components/cio/cio-format";
import { Button } from "@/components/ui/button";

type ValueMode = "nominal" | "real";
const WIDTH = 720;
const HEIGHT = 260;
const PADDING = { top: 24, right: 66, bottom: 38, left: 66 };

export function RetirementProjectionChart({
  scenarios,
  mode,
  currency,
}: Readonly<{
  scenarios: CioRetirementScenario[];
  mode: ValueMode;
  currency: string;
}>) {
  const [tableScenarioName, setTableScenarioName] = useState<CioRetirementScenarioName>("BASE");
  const allPoints = scenarios.flatMap((scenario) => scenario.points);
  if (!allPoints.length) return <p className="cio-chart-empty">No projection points are available.</p>;
  const tableScenario = scenarios.find((scenario) => scenario.scenario === tableScenarioName) ?? scenarios[0];

  const dates = allPoints.map((point) => new Date(`${point.date}T00:00:00.000Z`).getTime());
  const values = allPoints.map((point) => mode === "nominal" ? point.nominalCents : point.realCents);
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const maxValue = Math.max(1, ...values);
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (date: string) => PADDING.left + ((new Date(`${date}T00:00:00.000Z`).getTime() - minDate) / Math.max(1, maxDate - minDate)) * innerWidth;
  const y = (value: number) => PADDING.top + innerHeight - (value / maxValue) * innerHeight;
  const guideValues = [...new Set([0, 0.5, 1].map((fraction) => Math.round(maxValue * fraction)))];

  return (
    <div className="cio-retirement-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="cio-retirement-chart-title cio-retirement-chart-desc">
        <title id="cio-retirement-chart-title">Bear, base, and bull retirement projections</title>
        <desc id="cio-retirement-chart-desc">Projected {mode} portfolio value from {formatCioDate(new Date(minDate).toISOString())} through {formatCioDate(new Date(maxDate).toISOString())}. Line labels identify each scenario.</desc>
        {guideValues.map((value) => (
          <g key={value}>
            <line className="cio-projection-grid" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(value)} y2={y(value)} />
            <text className="cio-projection-axis-label" x={PADDING.left - 8} y={y(value) + 4} textAnchor="end">
              {compactMoney(value, currency)}
            </text>
          </g>
        ))}
        <text className="cio-projection-axis-label" x={PADDING.left} y={HEIGHT - 10}>{new Date(minDate).getUTCFullYear()}</text>
        <text className="cio-projection-axis-label" x={WIDTH - PADDING.right} y={HEIGHT - 10} textAnchor="end">{new Date(maxDate).getUTCFullYear()}</text>
        {scenarios.map((scenario, index) => {
          const path = scenario.points.map((point, pointIndex) => {
            const value = mode === "nominal" ? point.nominalCents : point.realCents;
            return `${pointIndex ? "L" : "M"} ${x(point.date)} ${y(value)}`;
          }).join(" ");
          const last = scenario.points.at(-1);
          const lastValue = mode === "nominal" ? (last?.nominalCents ?? 0) : (last?.realCents ?? 0);
          return (
            <g className={`cio-projection-series cio-projection-series-${index + 1}`} key={scenario.scenario}>
              <path d={path} vectorEffect="non-scaling-stroke" />
              {last ? <text x={x(last.date) + 8} y={y(lastValue) + 4}>{formatCioLabel(scenario.scenario)}</text> : null}
            </g>
          );
        })}
      </svg>

      <div className="cio-projection-legend" aria-label="Projection outcomes">
        {scenarios.map((scenario) => {
          const value = mode === "nominal" ? scenario.fundAtRetirementNominalCents : scenario.fundAtRetirementRealCents;
          return <span key={scenario.scenario}><strong>{formatCioLabel(scenario.scenario)} · {formatCioPercent(scenario.nominalReturnBps)}</strong>{formatCioMoney(value, currency)}</span>;
        })}
      </div>

      <details className="cio-chart-table-toggle">
        <summary>View yearly projection table</summary>
        <fieldset className="cio-segmented-control cio-projection-table-filter" aria-label="Yearly projection scenario">
          {scenarios.map((scenario) => (
            <Button
              key={scenario.scenario}
              variant="ghost"
              size="sm"
              className={scenario.scenario === tableScenario.scenario ? "is-active" : ""}
              onClick={() => setTableScenarioName(scenario.scenario)}
              aria-pressed={scenario.scenario === tableScenario.scenario}
              aria-label={`${formatCioLabel(scenario.scenario)} scenario, ${formatCioPercent(scenario.nominalReturnBps)} configured return`}
            >
              {formatCioLabel(scenario.scenario)} · {formatCioPercent(scenario.nominalReturnBps)}
            </Button>
          ))}
        </fieldset>
        <div className="cio-table-scroll">
          <table className="cio-data-table">
            <caption>{formatCioLabel(tableScenario.scenario)} yearly projection using the configured {formatCioPercent(tableScenario.nominalReturnBps)} nominal return.</caption>
            <thead><tr><th scope="col">Scenario</th><th scope="col">Date</th><th scope="col">Age</th><th scope="col">Projected value</th></tr></thead>
            <tbody>
              {tableScenario.points.map((point) => (
                <tr key={`${tableScenario.scenario}-${point.date}`}>
                  <th scope="row">{formatCioLabel(tableScenario.scenario)} · {formatCioPercent(tableScenario.nominalReturnBps)}</th>
                  <td>{formatCioDate(point.date)}</td>
                  <td>{point.age ?? "—"}</td>
                  <td>{formatCioMoney(mode === "nominal" ? point.nominalCents : point.realCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function compactMoney(cents: number, currency: string) {
  if (isPrivacyModeOn()) return MASKED_AMOUNT;
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}
