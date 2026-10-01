"use client";

import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

// Privacy mode hides balances and amounts on screen, like dark mode it is a per-device
// preference stored locally and applied before paint by public/theme-init.js.

export const PRIVACY_MODE_STORAGE_KEY = "nest-privacy-mode";
export const MASKED_AMOUNT = "••••••";

type Listener = () => void;
const listeners = new Set<Listener>();

function readAttribute() {
  return typeof document !== "undefined" && document.documentElement.dataset.privacy === "on";
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Current state for formatters outside React; callers must re-render through usePrivacyMode(). */
export function isPrivacyModeOn() {
  return readAttribute();
}

function apply(on: boolean) {
  if (on) document.documentElement.dataset.privacy = "on";
  else delete document.documentElement.dataset.privacy;
  // flushSync renders the masked (or revealed) amounts before the view transition captures the new state.
  flushSync(() => listeners.forEach((listener) => listener()));
}

export function setPrivacyMode(on: boolean) {
  try { window.localStorage.setItem(PRIVACY_MODE_STORAGE_KEY, on ? "on" : "off"); } catch { /* Storage is optional. */ }
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof document.startViewTransition !== "function") {
    apply(on);
    return;
  }
  // Amounts dissolve through a blur instead of swapping instantly; the CSS lives in privacy-mode.css.
  root.dataset.privacyTransition = on ? "hide" : "show";
  const transition = document.startViewTransition(() => apply(on));
  void transition.finished.finally(() => { delete root.dataset.privacyTransition; });
}

export function togglePrivacyMode() {
  setPrivacyMode(!readAttribute());
}

/** Whether amounts are hidden. Server render and hydration assume visible, then the stored choice applies. */
export function usePrivacyMode() {
  return useSyncExternalStore(subscribe, readAttribute, () => false);
}

/** Masks a formatted amount while privacy mode is on. */
export function maskAmount(formatted: string, hidden: boolean) {
  return hidden ? MASKED_AMOUNT : formatted;
}
