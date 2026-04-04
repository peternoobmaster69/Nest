"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";
import { AppBodySkeleton } from "./ui-skeleton";

type AppContext = {
  workspaceId?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
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

        <div className="body">{isContextLoading ? <AppBodySkeleton /> : children}</div>
      </main>
    </div>
  );
}
