"use client";

import {
  cloneElement,
  isValidElement,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "./modal-close-button";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const subscribeToClientReady = () => () => {};
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;

let viewportLockCount = 0;
let lockedScrollY = 0;
let previousBodyStyles: Partial<CSSStyleDeclaration> = {};
let previousHtmlOverflow = "";

function lockViewport() {
  viewportLockCount += 1;
  if (viewportLockCount > 1) return;
  lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  previousHtmlOverflow = document.documentElement.style.overflow;
  previousBodyStyles = {
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
    width: document.body.style.width,
    overflow: document.body.style.overflow,
  };
  document.documentElement.dataset.modalScrollLock = "true";
  document.body.dataset.modalScrollLock = "true";
  document.documentElement.style.overflow = "hidden";
  Object.assign(document.body.style, {
    position: "fixed",
    top: `-${lockedScrollY}px`,
    left: "0",
    right: "0",
    width: "100%",
    overflow: "hidden",
  });
}

function unlockViewport() {
  viewportLockCount = Math.max(0, viewportLockCount - 1);
  if (viewportLockCount > 0) return;
  delete document.documentElement.dataset.modalScrollLock;
  delete document.body.dataset.modalScrollLock;
  document.documentElement.style.overflow = previousHtmlOverflow;
  Object.assign(document.body.style, previousBodyStyles);
  window.scrollTo(0, lockedScrollY);
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty(
    "--visual-viewport-height",
    `${Math.round(viewport?.height ?? window.innerHeight)}px`,
  );
  document.documentElement.style.setProperty(
    "--visual-viewport-offset-top",
    `${Math.round(viewport?.offsetTop ?? 0)}px`,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeDisabled = false,
  overlayClassName = "",
  contentClassName = "",
  surface = "standard",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeDisabled?: boolean;
  overlayClassName?: string;
  contentClassName?: string;
  surface?: "standard" | "custom";
  labelledBy?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const clientReady = useSyncExternalStore(subscribeToClientReady, clientReadySnapshot, serverReadySnapshot);
  const containerRef = useRef<HTMLDialogElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useLayoutEffect(() => {
    if (!open || !clientReady) return;
    lockViewport();
    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);
    return () => {
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      unlockViewport();
      if (viewportLockCount === 0) {
        document.documentElement.style.removeProperty("--visual-viewport-height");
        document.documentElement.style.removeProperty("--visual-viewport-offset-top");
      }
    };
  }, [open, clientReady]);

  useEffect(() => {
    if (!open || !clientReady) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = surface === "custom"
      ? overlayRef.current?.firstElementChild as HTMLElement | null
      : containerRef.current;
    const preferredInitialFocus = container?.querySelector<HTMLElement>(
      "[data-dialog-initial-focus], [autofocus]",
    );
    const firstFocusable = container?.querySelector<HTMLElement>(FOCUSABLE);
    (preferredInitialFocus || firstFocusable || container)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open, surface, clientReady]);

  if (!open || !clientReady) return null;

  const customSurface = surface === "custom" && isValidElement(children) && children.type === "dialog"
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        open: true,
        "aria-modal": true,
        "aria-label": labelledBy ? undefined : title,
        "aria-labelledby": labelledBy,
        tabIndex: -1,
      })
    : null;

  return createPortal(
    <div
      ref={overlayRef}
      className={`${surface === "standard" ? "modal-overlay" : ""} ${overlayClassName}`.trim()}
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) onClose();
      }}
    >
      {customSurface || <dialog open
        ref={containerRef}
        className={`modal-container modal-${size} ${contentClassName}`.trim()}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id={titleId}>{title}</h2>
            {description ? <p className="modal-description" id={descriptionId}>{description}</p> : null}
          </div>
          <ModalCloseButton onClick={onClose} disabled={closeDisabled} label={`Close ${title}`} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </dialog>}
    </div>,
    document.body,
  );
}
