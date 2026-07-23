"use client";
import { RouteErrorState } from "@/components/ui/route-state";
export default function Error({ reset }: { error: Error; reset: () => void }) { return <RouteErrorState reset={reset} title="Workspace access could not be loaded" />; }
