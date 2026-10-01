"use client";

import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

// Every page renders its own app shell, so Ask Nest remounts on navigation. This module-level
// store keeps the conversation, any in-flight answer, and the minimized launcher alive across pages.

type Listener = () => void;
const values = new Map<string, unknown>();
const listeners = new Set<Listener>();
const LAUNCHER_KEY = "nest:ask-nest:launcher";

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function write(key: string, value: unknown) {
  if (Object.is(values.get(key), value)) return;
  values.set(key, value);
  listeners.forEach((listener) => listener());
}

export function useAskNestState<T>(name: string, initial: T) {
  const key = `thread:${name}`;
  const read = useCallback(() => (values.has(key) ? values.get(key) as T : initial), [key, initial]);
  const value = useSyncExternalStore(subscribe, read, () => initial);
  const setValue = useCallback((next: SetStateAction<T>) => {
    const current = values.has(key) ? values.get(key) as T : initial;
    write(key, typeof next === "function" ? (next as (previous: T) => T)(current) : next);
  }, [key, initial]);
  return [value, setValue] as const;
}

/** Whether the minimized launcher is pinned; it survives reloads in this tab until the user dismisses it. */
export function useAskNestLauncher() {
  const key = "launcher";
  const read = useCallback(() => {
    if (!values.has(key)) {
      let stored = false;
      try { stored = window.sessionStorage.getItem(LAUNCHER_KEY) === "true"; } catch { /* Storage is optional. */ }
      values.set(key, stored);
    }
    return values.get(key) as boolean;
  }, [key]);
  const pinned = useSyncExternalStore(subscribe, read, () => false);
  const setPinned = useCallback((next: boolean) => {
    try {
      if (next) window.sessionStorage.setItem(LAUNCHER_KEY, "true");
      else window.sessionStorage.removeItem(LAUNCHER_KEY);
    } catch { /* Storage is optional. */ }
    write(key, next);
  }, [key]);
  return [pinned, setPinned] as const;
}

/**
 * The thread belongs to one workspace. The id can arrive late (after context loads), so the
 * conversation resets only when a known workspace changes to a different known workspace.
 */
export function claimAskNestWorkspace(workspaceId: string | null | undefined) {
  if (!workspaceId) return;
  const owner = values.get("workspace");
  if (owner === workspaceId) return;
  values.set("workspace", workspaceId);
  if (owner === undefined) return;
  for (const key of [...values.keys()]) if (key.startsWith("thread:")) values.delete(key);
  // Called during render before any store reads, so subscribers pick up the reset without a notification.
  askNestFlags.clear();
}

/** One-shot flags (such as "history already requested") shared across remounts. */
export const askNestFlags = new Set<string>();
