"use client";

import { useEffect } from "react";

const MODAL_OVERLAY_SELECTOR = [
  ".modal-overlay",
  ".profile-modal-overlay",
  ".cc-modal-overlay",
  ".cct-modal-overlay",
  ".st-modal-overlay",
  ".auto-rule-modal-overlay",
].join(",");

export function ModalViewportManager() {
  useEffect(() => {
    let isLocked = false;
    let scrollY = 0;
    let animationFrame = 0;
    let previousBodyPosition = "";
    let previousBodyTop = "";
    let previousBodyLeft = "";
    let previousBodyRight = "";
    let previousBodyWidth = "";
    let previousBodyOverflow = "";
    let previousHtmlOverflow = "";

    const lockViewport = () => {
      if (isLocked) return;

      isLocked = true;
      scrollY = window.scrollY || document.documentElement.scrollTop || 0;

      previousBodyPosition = document.body.style.position;
      previousBodyTop = document.body.style.top;
      previousBodyLeft = document.body.style.left;
      previousBodyRight = document.body.style.right;
      previousBodyWidth = document.body.style.width;
      previousBodyOverflow = document.body.style.overflow;
      previousHtmlOverflow = document.documentElement.style.overflow;

      document.documentElement.dataset.modalScrollLock = "true";
      document.body.dataset.modalScrollLock = "true";
      document.documentElement.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
    };

    const unlockViewport = () => {
      if (!isLocked) return;

      isLocked = false;
      delete document.documentElement.dataset.modalScrollLock;
      delete document.body.dataset.modalScrollLock;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.body.style.overflow = previousBodyOverflow;
      window.scrollTo(0, scrollY);
    };

    const syncViewportLock = () => {
      animationFrame = 0;
      if (document.querySelector(MODAL_OVERLAY_SELECTOR)) {
        lockViewport();
      } else {
        unlockViewport();
      }
    };

    const scheduleSync = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(syncViewportLock);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      attributeFilter: ["class"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    syncViewportLock();

    return () => {
      observer.disconnect();
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      unlockViewport();
    };
  }, []);

  return null;
}
