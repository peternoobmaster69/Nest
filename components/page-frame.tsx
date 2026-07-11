"use client";

import { useQuery } from "@tanstack/react-query";
import { ReactNode } from "react";
import { AppShell } from "./app-shell";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from "@/lib/database-errors";

type AppContext = {
  workspaceId?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
};

class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(
      payload?.message || payload?.error || `Request failed (${res.status})`,
      res.status,
      payload?.code,
    );
  }
  return res.json();
}

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
  const contextQuery = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const isContextLoading = contextQuery.isLoading && !contextQuery.data;
  const contextError = contextQuery.error;
  const isDatabaseUnavailable =
    contextError instanceof ApiError &&
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
              <button className="btn btn-primary" onClick={() => contextQuery.refetch()}>
                Retry
              </button>
            </section>
          ) : (
            children
          )}
    </AppShell>
  );
}
