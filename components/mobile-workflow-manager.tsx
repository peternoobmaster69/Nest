"use client";

import { useIsMutating, useMutationState } from "@tanstack/react-query";
import { Check, LoaderCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SCROLL_KEY_PREFIX = "nest:scroll:";

function routeScrollKey(pathname: string) {
  return `${SCROLL_KEY_PREFIX}${pathname}${window.location.search}`;
}

export function MobileWorkflowManager() {
  const pathname = usePathname();
  const pendingMutations = useIsMutating();
  const failedMutationTimes = useMutationState({
    filters: { status: "error" },
    select: (mutation) => mutation.state.submittedAt,
  });
  const latestFailure = Math.max(0, ...failedMutationTimes);
  const previousPending = useRef(0);
  const activeMutationStartedAt = useRef(0);
  const restoreOnNextRoute = useRef(false);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (pendingMutations > 0) {
      if (previousPending.current === 0) activeMutationStartedAt.current = Date.now() - 1000;
      previousPending.current = pendingMutations;
      setShowSaved(false);
      return;
    }
    if (previousPending.current === 0) return;

    previousPending.current = 0;
    if (latestFailure >= activeMutationStartedAt.current) return;

    // Errors are surfaced by the global mutation cache. Only a successful
    // completion gets an acknowledgement in the application chrome.
    setShowSaved(true);
    const timeout = window.setTimeout(() => setShowSaved(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [latestFailure, pendingMutations]);

  useEffect(() => {
    const onPopState = () => {
      restoreOnNextRoute.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const key = routeScrollKey(pathname);
    let frame = 0;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    const storePosition = () => {
      try {
        window.sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        // Scroll restoration remains best-effort when storage is unavailable.
      }
    };
    const scheduleStore = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        storePosition();
      });
    };

    if (restoreOnNextRoute.current) {
      restoreOnNextRoute.current = false;
      let savedPosition = 0;
      try {
        savedPosition = Number(window.sessionStorage.getItem(key));
      } catch {
        // The browser's default top position is a safe fallback.
      }
      if (Number.isFinite(savedPosition) && savedPosition > 0) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => window.scrollTo({ top: savedPosition, behavior: "auto" }));
        });
      }
    }

    window.addEventListener("scroll", scheduleStore, { passive: true });
    window.addEventListener("pagehide", storePosition);
    return () => {
      storePosition();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleStore);
      window.removeEventListener("pagehide", storePosition);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, [pathname]);

  const visible = pendingMutations > 0 || showSaved;
  return (
    <div
      className={`mutation-feedback${visible ? " is-visible" : ""}${showSaved && pendingMutations === 0 ? " is-success" : ""}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      {pendingMutations > 0 ? (
        <><LoaderCircle size={16} className="mutation-feedback-spinner" aria-hidden="true" /> Saving changes&hellip;</>
      ) : (
        <><Check size={16} aria-hidden="true" /> Changes saved</>
      )}
    </div>
  );
}
