"use client";

import { useCallback } from "react";
import { formatMoney, formatMoneyShort } from "@/lib/currency";
import { maskAmount, usePrivacyMode } from "@/lib/privacy-mode";

/** Money formatters that respect privacy mode; components re-render when it is toggled. */
export function useMoneyFormat(currency?: string | null) {
  const hidden = usePrivacyMode();
  const format = useCallback((cents: number, override?: string | null) => maskAmount(formatMoney(cents, override ?? currency), hidden), [currency, hidden]);
  const formatShort = useCallback((cents: number) => maskAmount(formatMoneyShort(cents), hidden), [hidden]);
  const mask = useCallback((formatted: string) => maskAmount(formatted, hidden), [hidden]);
  return { format, formatShort, mask, hidden };
}
