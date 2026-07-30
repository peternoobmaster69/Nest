"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

type UrlFilterValue = string | number | boolean | null | undefined;

/**
 * Mirrors durable list/view filters into the current URL without discarding
 * unrelated deep-link parameters. Modal and other ephemeral state stays out
 * of the URL.
 */
export function useUrlFilterSync(
  filters: Record<string, UrlFilterValue>,
  ready = true,
) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const serializedFilters = JSON.stringify(filters);

  useEffect(() => {
    if (!ready) return;

    const next = new URLSearchParams(searchParams.toString());
    const entries = JSON.parse(serializedFilters) as Record<string, UrlFilterValue>;
    for (const [key, value] of Object.entries(entries)) {
      if (value === null || value === undefined || value === "") {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    }

    const nextQuery = next.toString();
    if (nextQuery === searchParams.toString()) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, ready, router, searchParams, serializedFilters]);
}
