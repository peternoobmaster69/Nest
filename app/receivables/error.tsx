"use client";
import { RouteErrorState } from "@/components/ui/route-state";
export default function Error({ reset }: { error: Error; reset: () => void }) { return <RouteErrorState reset={reset} title="Receivables could not be loaded" />; }
