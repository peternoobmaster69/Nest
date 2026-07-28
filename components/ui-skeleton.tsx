"use client";

import React from "react";

// Skeleton pulse animation wrapper
function SkeletonPulse({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`skeleton-pulse ${className}`} style={style}>
      {children}
    </div>
  );
}

// Generic skeleton block
const SkeletonBlock = React.memo(function SkeletonBlock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton-block ${className}`} style={style} />;
});

// Text line skeleton
const SkeletonText = React.memo(function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`skeleton-text-group ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-text" style={{ width: i === lines - 1 && lines > 1 ? "70%" : "100%" }} />
      ))}
    </div>
  );
});

// Transaction row skeleton
const SkeletonTransactionRow = React.memo(function SkeletonTransactionRow({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-tx-row ${className}`}>
      <SkeletonBlock className="skeleton-tx-icon" />
      <div className="skeleton-tx-details">
        <SkeletonText lines={2} />
      </div>
      <SkeletonBlock className="skeleton-tx-amount" />
    </SkeletonPulse>
  );
});

// List of skeleton rows
const SkeletonList = React.memo(function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonTransactionRow key={i} />
      ))}
    </div>
  );
});

export const SidebarSkeleton = React.memo(function SidebarSkeleton() {
  return (
    <>
      <div className="sb-scroll sb-skeleton-scroll">
        <div className="sb-sec">Overview</div>
        <div className="sb-skeleton-item skeleton-block" />

        <div className="sb-sec">Money</div>
        <div className="sb-skeleton-item skeleton-block" />
        <div className="sb-skeleton-item skeleton-block" />
        <div className="sb-skeleton-item skeleton-block" />
        <div className="sb-skeleton-item skeleton-block" />

        <div className="sb-sec">Workspace</div>
        <div className="sb-skeleton-item skeleton-block" />
        <div className="sb-skeleton-item skeleton-block" />
      </div>
      <div className="sb-bot">
        <div className="sb-skeleton-user">
          <div className="sb-skeleton-avatar skeleton-block" />
          <div className="sb-skeleton-meta">
            <div className="sb-skeleton-line skeleton-block" />
            <div className="sb-skeleton-line sb-skeleton-line-short skeleton-block" />
          </div>
        </div>
      </div>
    </>
  );
});

// Dashboard-specific skeleton that matches actual layout
const DashboardSkeleton = React.memo(function DashboardSkeleton() {
  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {/* Bank selector - use actual bank-selector-row container, only skeleton content inside */}
      <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
        <SkeletonPulse style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <SkeletonBlock style={{ width: "44px", height: "24px", borderRadius: "4px", flexShrink: 0 }} />
          <SkeletonBlock style={{ height: "18px", width: "100px" }} />
        </SkeletonPulse>
      </div>

      {/* Hero Card */}
      <SkeletonPulse className="skeleton-hero-card">
        <SkeletonText lines={2} />
        <SkeletonBlock className="skeleton-hero-amount" />
      </SkeletonPulse>

      {/* Credit Cards + Recent Transactions grid */}
      <div className="grid-2">
        <div className="card" style={{ padding: "18px 20px" }}>
          <SkeletonBlock className="skeleton-card-header" style={{ height: "18px", width: "100px", marginBottom: "14px" }} />
          <div className="skeleton-credit-card">
            <div className="skeleton-cc-header">
              <SkeletonBlock className="skeleton-cc-bank" />
            </div>
            <SkeletonBlock className="skeleton-cc-number" />
          </div>
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <SkeletonBlock className="skeleton-card-header" style={{ height: "18px", width: "120px", marginBottom: "14px" }} />
          <SkeletonList count={3} />
        </div>
      </div>
    </div>
  );
});

const AppBodySkeleton = React.memo(function AppBodySkeleton() {
  return (
    <DashboardSkeleton />
  );
});

export const AppShellSkeleton = React.memo(function AppShellSkeleton({ title = "Loading" }: { title?: string }) {
  return (
    <div className="app-shell" aria-busy="true" aria-live="polite">
      <aside className="sidebar">
        <div className="sb-logo">
          <div className="skeleton-block sb-skeleton-logo" />
        </div>
        <SidebarSkeleton />
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="tb-left">
            <div className="hamburger" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="tb-title">{title}</div>
          </div>
        </header>

        <div className="body">
          <AppBodySkeleton />
        </div>
      </main>
    </div>
  );
});

// Empty state component with icon and action
export const EmptyState = React.memo(function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-desc">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
});

// Loading overlay for buttons/actions
export const LoadingDots = React.memo(function LoadingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`loading-dots ${className}`}>
      <span />
      <span />
      <span />
    </span>
  );
});
