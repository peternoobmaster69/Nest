"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspaceId } from "@/components/workspace-provider";
import type { AppShellContext } from "@/components/app-shell-context";
import type { CioPolicy, CioSnapshot } from "@/components/cio/types";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export function useCioOverview() {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const context = useQuery({
    queryKey: queryKeys.context(routeWorkspaceId),
    queryFn: () => apiFetch<AppShellContext>("/api/context", { cache: "no-store" }),
  });
  const workspaceId = context.data?.workspaceId ?? routeWorkspaceId;

  const overview = useQuery({
    queryKey: queryKeys.cioOverview(workspaceId),
    queryFn: async () => (await apiFetch<{ overview: CioSnapshot }>("/api/cio/overview", { cache: "no-store" })).overview,
    enabled: Boolean(workspaceId),
  });

  const policy = useQuery({
    queryKey: queryKeys.cioPolicy(workspaceId),
    queryFn: async () => (await apiFetch<{ policy: CioPolicy | null }>("/api/cio/policy", { cache: "no-store" })).policy,
    enabled: Boolean(workspaceId),
  });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.cio(workspaceId) });
  }, [queryClient, workspaceId]);

  const role = context.data?.role;
  return {
    workspaceId,
    context,
    overview,
    policy,
    refresh,
    canEdit: role === "OWNER" || role === "EDITOR",
  };
}
