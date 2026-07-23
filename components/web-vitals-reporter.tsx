"use client";

import { useReportWebVitals } from "next/web-vitals";

type ChromiumPerformance = Performance & {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
};

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const memory = (performance as ChromiumPerformance).memory;
    const detail = {
      id: metric.id,
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      route: window.location.pathname,
      usedJsHeapBytes: memory?.usedJSHeapSize,
    };
    performance.mark(`nest:web-vital:${metric.name}`, { detail });
    window.dispatchEvent(new CustomEvent("nest:web-vital", { detail }));
  });

  return null;
}
