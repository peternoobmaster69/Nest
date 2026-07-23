"use client";

import { useEffect } from "react";

const MODAL_OVERLAY_SELECTOR = [
  ".modal-overlay",
  ".profile-modal-overlay",
  ".cc-modal-overlay",
  ".cct-modal-overlay",
  ".st-modal-overlay",
  ".auto-rule-modal-overlay",
  ".tx-popover-overlay",
].join(",");

const LEGACY_MODAL_SELECTOR = [
  ".profile-modal",
  ".cc-modal",
  ".cct-modal",
  ".st-modal",
  ".auto-rule-modal",
  ".inv-modal",
  ".tx-month-popover",
].join(",");

const FOCUSABLE_SELECTOR = "button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

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
    let previouslyFocused: HTMLElement | null = null;
    let generatedTitleId = 0;

    const syncVisualViewport = () => {
      const viewport = window.visualViewport;
      const height = Math.round(viewport?.height ?? window.innerHeight);
      const offsetTop = Math.round(viewport?.offsetTop ?? 0);
      document.documentElement.style.setProperty("--visual-viewport-height", `${height}px`);
      document.documentElement.style.setProperty("--visual-viewport-offset-top", `${offsetTop}px`);
    };

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
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
      previouslyFocused?.focus();
      previouslyFocused = null;
    };

    const syncViewportLock = () => {
      animationFrame = 0;
      const overlay = document.querySelector<HTMLElement>(MODAL_OVERLAY_SELECTOR);
      if (overlay) {
        lockViewport();
        const legacyModal = overlay.querySelector<HTMLElement>(LEGACY_MODAL_SELECTOR);
        if (legacyModal) {
          legacyModal.setAttribute("role", "dialog");
          legacyModal.setAttribute("aria-modal", "true");
          legacyModal.tabIndex = -1;
          if (!legacyModal.hasAttribute("aria-label") && !legacyModal.hasAttribute("aria-labelledby")) {
            const heading = legacyModal.querySelector<HTMLElement>("h1,h2,h3,[data-modal-title]");
            if (heading) {
              if (!heading.id) {
                generatedTitleId += 1;
                heading.id = `nest-modal-title-${generatedTitleId}`;
              }
              legacyModal.setAttribute("aria-labelledby", heading.id);
            } else {
              const closeLabel = legacyModal.querySelector<HTMLElement>(".modal-close")?.getAttribute("aria-label");
              legacyModal.setAttribute("aria-label", closeLabel?.replace(/^Close\s+/i, "") || "Dialog");
            }
          }
          if (!legacyModal.contains(document.activeElement)) {
            (legacyModal.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) || legacyModal).focus();
          }
        }
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
    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);
    syncViewportLock();

    const manageLegacyModalKeyboard = (event: KeyboardEvent) => {
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(MODAL_OVERLAY_SELECTOR));
      const overlay = overlays[overlays.length - 1];
      const modal = overlay?.querySelector<HTMLElement>(LEGACY_MODAL_SELECTOR);
      if (!modal) return;

      if (event.key === "Escape") {
        const closeButton = modal.querySelector<HTMLButtonElement>(".modal-close");
        if (closeButton && !closeButton.disabled) {
          event.preventDefault();
          closeButton.click();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", manageLegacyModalKeyboard);

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", manageLegacyModalKeyboard);
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-offset-top");
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      unlockViewport();
    };
  }, []);

  return null;
}
