"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { Home, Menu } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { SpeedInsights } from "@vercel/speed-insights/next";

export type AppShellContext = {
  workspaceId?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
};

export function AppShell({
  title,
  currentPath,
  userName,
  userEmail,
  userImage,
  onDisplayNameUpdated,
  badgeCounts,
  contextData,
  contextLoading,
  topbarTitle,
  children,
}: {
  title: string;
  currentPath: string;
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  onDisplayNameUpdated?: (name: string) => void;
  badgeCounts?: { budgets?: number; receivables?: number };
  contextData?: AppShellContext;
  contextLoading?: boolean;
  topbarTitle?: ReactNode;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const workspaceName = contextData?.workspaceName?.trim();
    document.title = workspaceName ? `${workspaceName} · ${title}` : `${title} · Nest`;
  }, [contextData?.workspaceName, title]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  return (
    <div className="app-shell">
      <AppSidebar
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
        onDisplayNameUpdated={onDisplayNameUpdated}
        currentPath={currentPath}
        badgeCounts={badgeCounts}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
        contextData={contextData}
        contextLoading={contextLoading}
      />
      <main className="main" id="main-content">
        <header className="topbar">
          <div className="tb-left">
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
              <Menu size={20} aria-hidden="true" />
            </button>
            {topbarTitle || (currentPath === "/" ? (
              <div className="tb-title">{title}</div>
            ) : (
              <nav className="tb-breadcrumb" aria-label="Breadcrumb">
                <ol className="breadcrumb-list">
                  <li className="breadcrumb-item">
                    <Link href="/" className="breadcrumb-link" aria-label="Dashboard">
                      <Home size={16} strokeWidth={1.5} />
                    </Link>
                  </li>
                  <li className="breadcrumb-separator" aria-hidden="true">/</li>
                  <li className="breadcrumb-item"><span className="breadcrumb-current" aria-current="page">{title}</span></li>
                </ol>
              </nav>
            ))}
          </div>
          <div className="tb-actions">
            <NotificationBell workspaceId={contextData?.workspaceId} />
          </div>
        </header>
        <div className="body">{children}</div>
      </main>
    </div>
  );
}
