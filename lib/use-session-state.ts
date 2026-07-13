"use client";

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";

/**
 * Keeps non-sensitive view preferences (filters, selected periods and tabs)
 * for the lifetime of the browser tab. Form values and financial mutations
 * must never be stored through this hook.
 */
export function useSessionState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const hydratedKey = useRef<string | null>(null);
  const skipInitialWrite = useRef(false);

  useEffect(() => {
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;

    try {
      const stored = window.sessionStorage.getItem(key);
      if (stored !== null) {
        skipInitialWrite.current = true;
        // The effect intentionally hydrates after the server render so stored
        // client preferences cannot cause a hydration mismatch.
        setValue(JSON.parse(stored) as T);
      }
    } catch {
      // Storage can be unavailable in private browsing or embedded contexts.
    }
  }, [key]);

  useEffect(() => {
    if (hydratedKey.current !== key) return;
    if (skipInitialWrite.current) {
      skipInitialWrite.current = false;
      return;
    }
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // View state persistence is an enhancement, never a workflow blocker.
    }
  }, [key, value]);

  return [value, setValue];
}
