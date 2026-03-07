"use client";

import { useEffect, useState } from "react";
import { ReactNode } from "react";
import { AppSidebar } from "./app-sidebar";

export function PageFrame({
  title,
  current,
  userName,
  badgeCounts,
  children,
}: {
  title: string;
  current: string;
  userName: string;
  badgeCounts?: {
    budgets?: number;
    receivables?: number;
  };
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        currentPath={current}
        badgeCounts={badgeCounts}
        sidebarOpen={sidebarOpen}
        onSidebarChange={setSidebarOpen}
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

        <div className="body">{children}</div>
      </main>
    </div>
  );
}
