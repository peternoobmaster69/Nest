"use client";

import { useEffect, useState, type RefObject } from "react";
import { getMotionSafeScrollBehavior } from "@/lib/motion";

const SCROLL_TO_TOP_MIN_OFFSET = 480;

export function useShellScroll(
  bodyRef: RefObject<HTMLDivElement | null>,
  mainRef: RefObject<HTMLElement | null>,
  currentPath: string,
) {
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  useEffect(() => {
    const scrollContainer = bodyRef.current!;
    let animationFrame = 0;
    const updateVisibility = () => {
      animationFrame = 0;
      const isLongPage = scrollContainer.scrollHeight > scrollContainer.clientHeight * 1.5;
      const revealOffset = Math.max(SCROLL_TO_TOP_MIN_OFFSET, scrollContainer.clientHeight * 0.75);
      setShowScrollToTop(isLongPage && scrollContainer.scrollTop > revealOffset);
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    scrollContainer.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [bodyRef, currentPath]);

  const scrollToTop = () => {
    bodyRef.current?.scrollTo({ top: 0, behavior: getMotionSafeScrollBehavior() });
    mainRef.current?.focus({ preventScroll: true });
  };
  return { showScrollToTop, scrollToTop };
}

export function useMobileMoreFocus(
  open: boolean,
  menuRef: RefObject<HTMLDialogElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])")?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])"),
      );
      if (!focusable.length) return;
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
    document.documentElement.dataset.mobileMoreOpen = "true";
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      delete document.documentElement.dataset.mobileMoreOpen;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open, menuRef, triggerRef, setOpen]);
}

export function useSidebarMenus({
  open, setOpen, sidebarRef, profileMenuOpen, setProfileMenuOpen, profileMenuRef,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  sidebarRef: RefObject<HTMLElement | null>;
  profileMenuOpen: boolean;
  setProfileMenuOpen: (open: boolean) => void;
  profileMenuRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!sidebarRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, setOpen, sidebarRef]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      profileMenuRef.current?.querySelector<HTMLElement>(".sb-user-menu a[href],.sb-user-menu button:not([disabled])")?.focus();
    });
    const onClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", onClick);
    };
  }, [profileMenuOpen, setProfileMenuOpen, profileMenuRef]);
}
