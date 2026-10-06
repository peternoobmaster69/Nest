"use client";

import Link from "next/link";
import type { AskNestVisualization } from "@/lib/ai/ask-nest-types";
import { buildWorkspacePath } from "@/lib/workspace-entry";

export function formatAsOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(date);
}

export function renderWithFormattedDates(value: string) {
  const parts = value.split(/(\b\d{4}-\d{2}-\d{2}\b)/g);
  return parts.map((part, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return part;
    const date = new Date(`${part}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== part) return part;
    const label = new Intl.DateTimeFormat("en-SG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    return <time className="ask-nest-inline-date" dateTime={part} title={part} key={`${part}-${index}`}>{label}</time>;
  });
}

function formatChartPeriodLabel(value: string, compact = false) {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value);
  if (!monthMatch) return value;
  const date = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  const month = new Intl.DateTimeFormat("en-SG", { month: "short", timeZone: "UTC" }).format(date);
  return compact ? `${month} ’${monthMatch[1]!.slice(2)}` : `${month} ${monthMatch[1]}`;
}

export function AskNestVisualizationView({ visualization, onNavigate, workspaceId }: Readonly<{
  visualization: AskNestVisualization;
  onNavigate: () => void;
  workspaceId?: string | null;
}>) {
  if (visualization.type === "trip_cards") {
    if (!visualization.items.length) return null;
    return (
      <section className="ask-nest-visual ask-nest-trip-visual" aria-label={visualization.title}>
        <h4>{visualization.title}</h4>
        <div className="ask-nest-trip-grid">
          {visualization.items.map((item) => (
            <Link key={`${item.label}-${item.href}`} href={workspaceId ? buildWorkspacePath(workspaceId, item.href) : item.href} onClick={onNavigate}>
              <span className="ask-nest-trip-flag" aria-hidden="true">{item.flag}</span>
              <span className="ask-nest-trip-copy">
                <strong>{item.label}</strong>
                <small>{renderWithFormattedDates(item.dateRange)}</small>
              </span>
              <b>{item.amount}</b>
            </Link>
          ))}
        </div>
        {visualization.disclaimer ? <p className="ask-nest-visual-disclaimer">{visualization.disclaimer}</p> : null}
      </section>
    );
  }

  if (visualization.type === "trend_chart") {
    if (!visualization.points.length) return null;
    const width = 380;
    const height = 150;
    const padding = { top: 16, right: 12, bottom: 32, left: 12 };
    const max = Math.max(1, ...visualization.points.map((point) => point.valueCents));
    const denominator = Math.max(1, visualization.points.length - 1);
    const coordinates = visualization.points.map((point, index) => ({
      ...point,
      compactLabel: formatChartPeriodLabel(point.label, true),
      readableLabel: formatChartPeriodLabel(point.label),
      x: padding.left + (index / denominator) * (width - padding.left - padding.right),
      y: padding.top + (1 - point.valueCents / max) * (height - padding.top - padding.bottom),
    }));
    const labelEvery = Math.max(1, Math.ceil(coordinates.length / 4));
    return (
      <figure className="ask-nest-visual ask-nest-chart">
        <figcaption>{visualization.title}</figcaption>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${visualization.title} in ${visualization.currency}`}>
          <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} className="ask-nest-chart-axis" />
          <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} className="ask-nest-chart-line" />
          {coordinates.map((point, index) => (
            <g key={`${point.label}-${index}`}>
              <circle cx={point.x} cy={point.y} r="4" className="ask-nest-chart-dot"><title>{`${point.readableLabel}: ${point.formattedValue}`}</title></circle>
              {(index % labelEvery === 0 || index === coordinates.length - 1) ? (
                <text x={point.x} y={height - 10} textAnchor="middle">{point.compactLabel}</text>
              ) : null}
            </g>
          ))}
        </svg>
        <dl className="ask-nest-chart-values" aria-label="Most recent chart values">
          {coordinates.slice(-3).map((point) => (
            <div key={point.label}>
              <dt>{point.readableLabel}</dt>
              <dd>{point.formattedValue}</dd>
            </div>
          ))}
        </dl>
      </figure>
    );
  }

  if (!visualization.items.length) return null;
  const max = Math.max(1, ...visualization.items.flatMap((item) => [item.investedCents, item.currentValueCents]));
  return (
    <figure className="ask-nest-visual ask-nest-investment-chart">
      <figcaption>{visualization.title}</figcaption>
      <div className="ask-nest-investment-legend"><span className="is-invested">Invested</span><span className="is-current">Current</span></div>
      <div className="ask-nest-investment-rows">
        {visualization.items.map((item) => (
          <div className="ask-nest-investment-row" key={item.id}>
            <strong>{item.label}</strong>
            <div className="ask-nest-investment-bars">
              <span className="is-invested" style={{ width: `${Math.max(2, item.investedCents / max * 100)}%` }} title={`Invested ${item.invested}`} />
              <span className="is-current" style={{ width: `${Math.max(2, item.currentValueCents / max * 100)}%` }} title={`Current ${item.currentValue}`} />
            </div>
            <small>{item.invested} → {item.currentValue}</small>
          </div>
        ))}
      </div>
    </figure>
  );
}
