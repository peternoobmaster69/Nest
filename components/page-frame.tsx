"use client";

import { ApiClientError, apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useQuery } from "@tanstack/react-query";
import { ReactNode } from "react";
import { AppShell } from "./app-shell";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from "@/lib/database-errors";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import type { AppShellContext } from "@/components/app-shell-context";

type AppContext = AppShellContext;

export function PageFrame({
  title,
  current,
  userName,
  userEmail,
  userImage,
  badgeCounts,
  children,
}: {
  title: string;
  current: string;
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  badgeCounts?: {
    budgets?: number;
    receivables?: number;
  };
  children: ReactNode;
}) {
  const workspaceId = useWorkspaceId();
  const contextQuery = useQuery({
    queryKey: queryKeys.context(workspaceId),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const isContextLoading = contextQuery.isLoading && !contextQuery.data;
  const contextError = contextQuery.error;
  const isDatabaseUnavailable =
    contextError instanceof ApiClientError &&
    (contextError.code === DATABASE_UNAVAILABLE_CODE || contextError.status === 503);

  return (
    <AppShell
        title={title}
        currentPath={current}
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
        badgeCounts={badgeCounts}
        contextData={contextQuery.data}
        contextLoading={isContextLoading}
    >
          {isDatabaseUnavailable ? (
            <section className="service-state" role="alert" aria-live="assertive">
              <div className="service-state-eyebrow">Service interruption</div>
              <h2 className="service-state-title">Database unavailable</h2>
              <p className="service-state-copy">
                {contextError.message || DATABASE_UNAVAILABLE_MESSAGE}
              </p>
              <Button className="btn btn-primary" onClick={() => contextQuery.refetch()}>
                Retry
              </Button>
            </section>
          ) : (
            children
          )}
    </AppShell>
  );
}
