"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { ChartCursorTooltip, useChartCursorTooltip } from "@/components/chart-cursor-tooltip";
import { Button } from "@/components/ui/button";

const CASH_FLOW_CHART_HEIGHT = 220;
const CASH_FLOW_CHART_PADDING = { top: 14, right: 14, bottom: 34, left: 42 };
const CASH_FLOW_MIN_ZOOM = 1;
const CASH_FLOW_MAX_ZOOM = 3;
const CASH_FLOW_ZOOM_STEP = 0.5;

export type CashFlowPoint = {
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  key: string;
  label: string;
};

export function CashFlowChart({
  points,
  formatShort,
  formatFull,
}: Readonly<{
  points: CashFlowPoint[];
  formatShort: (value: number) => string;
  formatFull: (value: number) => string;
}>) {
  const shellRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLFieldSetElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const tooltip = useChartCursorTooltip<CashFlowPoint>(shellRef);

  useEffect(() => {
    // The chart wrapper is always rendered before this effect runs.
    const chartElement = chartRef.current!;

    const updateWidth = () => {
      setMeasuredWidth(Math.floor(chartElement.getBoundingClientRect().width));
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(chartElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= points.length) {
      setActiveIndex(null);
      tooltip.clear();
    }
  }, [activeIndex, points.length, tooltip]);

  const minChartWidth = 520;
  const baseChartWidth = Math.max(minChartWidth, measuredWidth);
  const chartWidth = Math.round(baseChartWidth * zoomLevel);
  const left = Math.min(CASH_FLOW_CHART_PADDING.left, Math.max(28, chartWidth * 0.16));
  const right = Math.min(CASH_FLOW_CHART_PADDING.right, Math.max(8, chartWidth * 0.04));
  const { top, bottom } = CASH_FLOW_CHART_PADDING;
  const plotWidth = Math.max(1, chartWidth - left - right);
  const plotHeight = CASH_FLOW_CHART_HEIGHT - top - bottom;
  const zeroY = top + plotHeight / 2;
  const maxAbs = Math.max(
    1,
    ...points.flatMap((point) => [point.inflowCents, point.outflowCents, Math.abs(point.netCents)]),
  );
  const xFor = (index: number) =>
    left + (plotWidth / Math.max(points.length, 1)) * (index + 0.5);
  const yFor = (value: number) => zeroY - (value / maxAbs) * (plotHeight / 2);
  const barWidth = Math.min(22, plotWidth / Math.max(points.length * 1.8, 1));
  const monthLabelStride = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 34))));
  const netPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(point.netCents).toFixed(1)}`)
    .join(" ");
  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;
  const formatSignedFull = (value: number) => (value >= 0 ? `+${formatFull(value)}` : `-${formatFull(Math.abs(value))}`);
  const zoomPercent = Math.round(zoomLevel * 100);
  const canZoomOut = zoomLevel > CASH_FLOW_MIN_ZOOM;
  const canZoomIn = zoomLevel < CASH_FLOW_MAX_ZOOM;
  const zoomOut = () => setZoomLevel((current) => Math.max(CASH_FLOW_MIN_ZOOM, current - CASH_FLOW_ZOOM_STEP));
  const zoomIn = () => setZoomLevel((current) => Math.min(CASH_FLOW_MAX_ZOOM, current + CASH_FLOW_ZOOM_STEP));
  const resetZoom = () => setZoomLevel(CASH_FLOW_MIN_ZOOM);
  const setTooltipFromFocus = (index: number) => {
    // Focus events come from points inside the mounted chart wrapper.
    const shellElement = shellRef.current!;
    const chartElement = chartRef.current!;

    const shellRect = shellElement.getBoundingClientRect();
    const chartRect = chartElement.getBoundingClientRect();
    const x = chartRect.left - shellRect.left + xFor(index) - chartElement.scrollLeft;
    const y = chartRect.top - shellRect.top + top + plotHeight / 2;
    tooltip.showAtLocalPoint(x, y, points[index]);
  };
  const clearActivePoint = () => {
    setActiveIndex(null);
    tooltip.clear();
  };

  return (
    <div ref={shellRef} className="cash-flow-chart-shell">
      <div className="cash-flow-chart-tools" aria-label="Cash flow chart zoom controls">
        <Button
          type="button"
          className="btn btn-ghost btn-icon btn-xs cash-flow-chart-tool"
          onClick={zoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out cash flow months"
          title="Zoom out"
        >
          <ZoomOut size={15} aria-hidden="true" />
        </Button>
        <span className="cash-flow-zoom-value" aria-live="polite">{zoomPercent}%</span>
        <Button
          type="button"
          className="btn btn-ghost btn-icon btn-xs cash-flow-chart-tool"
          onClick={zoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in cash flow months"
          title="Zoom in"
        >
          <ZoomIn size={15} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          className="btn btn-ghost btn-icon btn-xs cash-flow-chart-tool"
          onClick={resetZoom}
          disabled={!canZoomOut}
          aria-label="Reset cash flow zoom"
          title="Reset zoom"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </Button>
      </div>

      <fieldset ref={chartRef} className="cash-flow-chart-wrap" aria-label="Cash flow over the last 12 months">
        <svg
          className="cash-flow-chart"
          style={{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }}
          viewBox={`0 0 ${chartWidth} ${CASH_FLOW_CHART_HEIGHT}`}
          onPointerLeave={clearActivePoint}
        >
          {[["top", top], ["zero", zeroY], ["bottom", top + plotHeight]].map(([position, y]) => (
            <line
              key={position}
              className={position === "zero" ? "cash-flow-zero-line" : "cash-flow-grid-line"}
              x1={left}
              x2={chartWidth - right}
              y1={y}
              y2={y}
            />
          ))}
          <text className="cash-flow-axis-label" x={8} y={top + 4}>
            {formatShort(maxAbs)}
          </text>
          <text className="cash-flow-axis-label" x={8} y={zeroY + 4}>
            0
          </text>
          <text className="cash-flow-axis-label" x={8} y={top + plotHeight + 4}>
            -{formatShort(maxAbs)}
          </text>

          {points.map((point, index) => {
            const centerX = xFor(index);
            const x = centerX - barWidth / 2;
            const inflowY = yFor(point.inflowCents);
            const outflowY = yFor(-point.outflowCents);
            const showMonthLabel = index % monthLabelStride === 0 || index === points.length - 1;
            const isActive = activeIndex === index;
            const hitWidth = Math.max(36, plotWidth / Math.max(points.length, 1));

            return (
              <g key={point.key} className={isActive ? "cash-flow-point-group active" : "cash-flow-point-group"}>
                <rect
                  className="cash-flow-hit-area"
                  x={Math.max(left, centerX - hitWidth / 2)}
                  y={top}
                  width={Math.min(hitWidth, chartWidth - right - Math.max(left, centerX - hitWidth / 2))}
                  height={plotHeight}
                  rx="8"
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.label}: In ${formatFull(point.inflowCents)}, out ${formatFull(point.outflowCents)}, net ${formatSignedFull(point.netCents)}`}
                  onPointerEnter={(event) => {
                    setActiveIndex(index);
                    tooltip.showAtPointer(event, point);
                  }}
                  onPointerMove={(event) => {
                    setActiveIndex(index);
                    tooltip.showAtPointer(event, point);
                  }}
                  onFocus={() => {
                    setActiveIndex(index);
                    setTooltipFromFocus(index);
                  }}
                  onBlur={clearActivePoint}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveIndex(index);
                      setTooltipFromFocus(index);
                    }
                  }}
                  onClick={(event) => {
                    setActiveIndex(index);
                    tooltip.showAtPointer(event, point);
                  }}
                />
                <line
                  className="cash-flow-hover-line"
                  x1={centerX}
                  x2={centerX}
                  y1={top}
                  y2={top + plotHeight}
                />
                <rect
                  className="cash-flow-bar cash-flow-bar-in"
                  x={x}
                  y={inflowY}
                  width={barWidth}
                  height={Math.max(0, zeroY - inflowY)}
                  rx="4"
                />
                <rect
                  className="cash-flow-bar cash-flow-bar-out"
                  x={x}
                  y={zeroY}
                  width={barWidth}
                  height={Math.max(0, outflowY - zeroY)}
                  rx="4"
                />
                {showMonthLabel ? (
                  <text
                    className="cash-flow-month-label"
                    x={centerX}
                    y={CASH_FLOW_CHART_HEIGHT - 7}
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {points.length > 0 ? (
            <>
              <path className="cash-flow-net-line" d={netPath} />
              {points.map((point, index) => (
                <circle
                  key={point.key}
                  className={activeIndex === index ? "cash-flow-net-point active" : "cash-flow-net-point"}
                  cx={xFor(index)}
                  cy={yFor(point.netCents)}
                  r={activeIndex === index ? "5" : "3.5"}
                  onMouseEnter={() => setActiveIndex(index)}
                />
              ))}
            </>
          ) : null}
        </svg>
      </fieldset>

      {activePoint && tooltip.position ? (
        <ChartCursorTooltip position={tooltip.position}>
          <strong>{activePoint.label}</strong>
          <span><i className="cash-flow-dot cash-flow-dot-in" />In {formatFull(activePoint.inflowCents)}</span>
          <span><i className="cash-flow-dot cash-flow-dot-out" />Out {formatFull(activePoint.outflowCents)}</span>
          <span><i className="cash-flow-dot cash-flow-dot-net" />Net {formatSignedFull(activePoint.netCents)}</span>
        </ChartCursorTooltip>
      ) : null}
    </div>
  );
}
