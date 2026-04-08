"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";
import { AppBodySkeleton } from "./ui-skeleton";
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
  userImage,
  badgeCounts,
  children,
}: {
  title: string;
  current: string;
  userName: string;
  userImage?: string | null;
  badgeCounts?: {
    budgets?: number;
    receivables?: number;
  };
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const contextQuery = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const isContextLoading = contextQuery.isLoading && !contextQuery.data;
  const contextError = contextQuery.error;
  const isDatabaseUnavailable =
    contextError instanceof ApiError &&
    (contextError.code === DATABASE_UNAVAILABLE_CODE || contextError.status === 503);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem("nest:ui:sidebarOpen");
    if (saved === "1") {
      setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("nest:ui:sidebarOpen", sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  return (
    <div className="app-shell">
      <AppSidebar
        userName={userName}
        userImage={userImage}
        currentPath={current}
        badgeCounts={badgeCounts}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
        contextData={contextQuery.data}
        contextLoading={isContextLoading}
      />

      <main className="main">
        <header className="topbar">
          <div className="tb-left">
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div className="tb-title">{title}</div>
          </div>
        </header>

        <div className="body">
          {isContextLoading ? (
            <AppBodySkeleton />
          ) : isDatabaseUnavailable ? (
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
        </div>
      </main>
    </div>
  );
}
