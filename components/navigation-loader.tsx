"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const ROUTE_START_MARK = "nest-route-start";
const ROUTE_END_MARK = "nest-route-end";
const ROUTE_MEASURE = "nest-route-transition";

function NavigationLoaderContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteKey = useRef(routeKey);
  const navigationStartedAt = useRef(0);
  const progressInterval = useRef<number | null>(null);
  const hideTimeout = useRef<number | null>(null);
  const stalledTimeout = useRef<number | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const clearTimer = (timer: { current: number | null }) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };

    const beginNavigation = () => {
      if (navigationStartedAt.current > 0) return;
      clearTimer(hideTimeout);
      clearTimer(stalledTimeout);
      if (progressInterval.current !== null) window.clearInterval(progressInterval.current);

      navigationStartedAt.current = performance.now();
      performance.clearMarks(ROUTE_START_MARK);
      performance.mark(ROUTE_START_MARK);
      setIsNavigating(true);
      setProgress(18);

      progressInterval.current = window.setInterval(() => {
        setProgress((current) => Math.min(92, current + Math.max(1, (92 - current) * 0.16)));
      }, 180);
      stalledTimeout.current = window.setTimeout(() => {
        navigationStartedAt.current = 0;
        if (progressInterval.current !== null) window.clearInterval(progressInterval.current);
        progressInterval.current = null;
        setIsNavigating(false);
        setProgress(0);
      }, 15_000);
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return;
      beginNavigation();
    };

    document.addEventListener("click", onDocumentClick, true);
    window.addEventListener("popstate", beginNavigation);
    return () => {
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener("popstate", beginNavigation);
      if (progressInterval.current !== null) window.clearInterval(progressInterval.current);
      clearTimer(hideTimeout);
      clearTimer(stalledTimeout);
    };
  }, []);

  useEffect(() => {
    if (previousRouteKey.current === routeKey) return;
    previousRouteKey.current = routeKey;
    if (navigationStartedAt.current <= 0) return;

    const durationMs = performance.now() - navigationStartedAt.current;
    navigationStartedAt.current = 0;
    if (progressInterval.current !== null) window.clearInterval(progressInterval.current);
    progressInterval.current = null;
    if (stalledTimeout.current !== null) window.clearTimeout(stalledTimeout.current);
    stalledTimeout.current = null;

    performance.clearMarks(ROUTE_END_MARK);
    performance.mark(ROUTE_END_MARK);
    performance.measure(ROUTE_MEASURE, ROUTE_START_MARK, ROUTE_END_MARK);
    window.dispatchEvent(new CustomEvent("nest:route-performance", {
      detail: { durationMs, route: pathname },
    }));

    setProgress(100);
    hideTimeout.current = window.setTimeout(() => {
      setIsNavigating(false);
      setProgress(0);
      hideTimeout.current = null;
    }, 180);
  }, [pathname, routeKey]);

  if (!isNavigating && progress === 0) return null;

  const displayProgress = Math.min(progress, 100);

  return (
    <div
      className="navigation-loader"
      role="progressbar"
      aria-label="Loading page"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(displayProgress)}
      aria-busy={isNavigating}
    >
      <div
        className="navigation-loader-bar"
        style={{
          transform: `translateX(${-100 + displayProgress}%)`,
          opacity: displayProgress < 100 ? 1 : 0,
        }}
      />
    </div>
  );
}

export function NavigationLoader() {
  return (
    <Suspense fallback={null}>
      <NavigationLoaderContent />
    </Suspense>
  );
}
