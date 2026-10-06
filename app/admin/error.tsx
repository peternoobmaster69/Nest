"use client";
import { RouteErrorState } from "@/components/ui/route-state";
export default function PageError({ reset }: Readonly<{ reset: () => void }>) { return <RouteErrorState reset={reset} title="Administration could not be loaded" />; }
