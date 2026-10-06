"use client";

import Link from "next/link";
import { AlertTriangle, FileQuestion, LoaderCircle } from "lucide-react";
import { Button } from "./button";

export function RouteLoadingState({ label = "Loading your workspace" }: Readonly<{ label?: string }>) {
  return (
    <main className="route-state" aria-busy="true" aria-live="polite">
      <LoaderCircle className="route-state-spinner" size={28} aria-hidden="true" />
      <h1>{label}</h1>
      <p>Your previous data stays visible during background refreshes.</p>
    </main>
  );
}

export function RouteErrorState({
  reset,
  title = "This screen could not be loaded",
}: Readonly<{
  reset: () => void;
  title?: string;
}>) {
  return (
    <main className="route-state" role="alert">
      <AlertTriangle size={30} aria-hidden="true" />
      <h1>{title}</h1>
      <p>Try again. If the problem continues, open Settings to check your workspace access.</p>
      <div className="route-state-actions">
        <Button variant="primary" onClick={reset}>Try again</Button>
        <Link className="btn btn-ghost" href="/settings">Open Settings</Link>
      </div>
    </main>
  );
}

export function RouteNotFoundState() {
  return (
    <main className="route-state">
      <FileQuestion size={30} aria-hidden="true" />
      <h1>We could not find that screen</h1>
      <p>The link may be old, or this workspace may no longer be available to you.</p>
      <div className="route-state-actions">
        <Link className="btn btn-primary" href="/">Go to dashboard</Link>
        <Link className="btn btn-ghost" href="/settings">Open Settings</Link>
      </div>
    </main>
  );
}
