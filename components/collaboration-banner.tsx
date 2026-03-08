"use client";

import { useQuery } from "@tanstack/react-query";

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
  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  if (!context.data?.workspaceId || !context.data?.isShared) return null;

  return (
    <div className="collab-banner">
      Shared workspace: <strong>{context.data.workspaceName || "Workspace"}</strong>. Updates are visible to collaborators.
    </div>
  );
}
