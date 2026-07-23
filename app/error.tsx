"use client";

import { useEffect } from "react";
import { RouteErrorState } from "@/components/ui/route-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Route error", error);
  }, [error]);
  return <RouteErrorState reset={reset} />;
}
