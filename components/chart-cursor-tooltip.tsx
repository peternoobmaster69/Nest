"use client";

import { ReactNode, RefObject, useCallback, useMemo, useState } from "react";

type TooltipSide = "left" | "right";

type CursorPointEvent = {
  clientX: number;
  clientY: number;
};

export type ChartCursorTooltipPosition = {
  x: number;
  y: number;
  side: TooltipSide;
};

export function useChartCursorTooltip<T>(
  containerRef: RefObject<HTMLElement | null>,
  edgePadding = 180,
) {
  const [item, setItem] = useState<T | null>(null);
  const [position, setPosition] = useState<ChartCursorTooltipPosition | null>(null);

  const setPositionFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const containerElement = containerRef.current;
    if (!containerElement) return;

    const rect = containerElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    setPosition({
      x,
      y,
      side: x > rect.width - edgePadding ? "left" : "right",
    });
  }, [containerRef, edgePadding]);

  const showAtPointer = useCallback((event: CursorPointEvent, nextItem: T) => {
    setItem(nextItem);
    setPositionFromClientPoint(event.clientX, event.clientY);
  }, [setPositionFromClientPoint]);

  const showAtLocalPoint = useCallback((x: number, y: number, nextItem: T) => {
    const containerElement = containerRef.current;
    if (!containerElement) return;

    const rect = containerElement.getBoundingClientRect();
    setItem(nextItem);
    setPosition({
      x,
      y,
      side: x > rect.width - edgePadding ? "left" : "right",
    });
  }, [containerRef, edgePadding]);

  const clear = useCallback(() => {
    setItem(null);
    setPosition(null);
  }, []);

  return useMemo(() => ({
    item,
    position,
    showAtPointer,
    showAtLocalPoint,
    clear,
  }), [clear, item, position, showAtLocalPoint, showAtPointer]);
}

export function ChartCursorTooltip({
  position,
  className,
  children,
}: Readonly<{
  position: ChartCursorTooltipPosition;
  className?: string;
  children: ReactNode;
}>) {
  const customClass = className ? " " + className : "";
  return (
    <div
      className={`chart-cursor-tooltip ${position.side}${customClass}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      aria-live="polite"
    >
      {children}
    </div>
  );
}
