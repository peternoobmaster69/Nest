"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export function CollaborationBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = context.data?.workspaceId;

  // Check if banner was previously dismissed for this workspace
  useEffect(() => {
    if (!workspaceId || typeof window === "undefined") return;
    const dismissed = localStorage.getItem(`nest:collab-banner:${workspaceId}`);
    if (dismissed === "1") {
      setIsDismissed(true);
    }
  }, [workspaceId]);

  const handleDismiss = () => {
    setIsAnimating(true);
    // Wait for animation to complete before hiding
    setTimeout(() => {
      setIsDismissed(true);
      if (workspaceId && typeof window !== "undefined") {
        localStorage.setItem(`nest:collab-banner:${workspaceId}`, "1");
      }
    }, 200);
  };

  if (!workspaceId || !context.data?.isShared || isDismissed) return null;

  return (
    <div
      className={`collab-banner-modern ${isAnimating ? "collab-banner-exit" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="collab-banner-content">
        <span className="collab-banner-icon" aria-hidden="true">👥</span>
        <div className="collab-banner-text">
          <span className="collab-banner-title">
            Shared Workspace: <strong>{context.data.workspaceName || "Workspace"}</strong>
          </span>
          <span className="collab-banner-subtitle">
            Changes you make are visible to collaborators
          </span>
        </div>
      </div>
      <button
        className="collab-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss shared workspace notice"
        title="Got it"
      >
        <span>Got it</span>
        <span className="collab-banner-close-icon" aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
