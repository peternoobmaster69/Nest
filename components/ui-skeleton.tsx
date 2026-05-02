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
export const SkeletonBlock = React.memo(function SkeletonBlock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton-block ${className}`} style={style} />;
});

// Text line skeleton
export const SkeletonText = React.memo(function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`skeleton-text-group ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-text" style={{ width: i === lines - 1 && lines > 1 ? "70%" : "100%" }} />
      ))}
    </div>
  );
});

// Card skeleton
export const SkeletonCard = React.memo(function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-card ${className}`}>
      <div className="skeleton-card-header">
        <SkeletonBlock className="skeleton-icon" />
        <div className="skeleton-card-meta">
          <SkeletonText lines={2} />
        </div>
      </div>
      <SkeletonBlock className="skeleton-card-amount" />
    </SkeletonPulse>
  );
});

// Bank account card skeleton
export const SkeletonBankCard = React.memo(function SkeletonBankCard({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-bank-card ${className}`}>
      <div className="skeleton-bank-header">
        <SkeletonBlock className="skeleton-bank-logo" />
        <SkeletonBlock className="skeleton-bank-actions" />
      </div>
      <div className="skeleton-bank-body">
        <SkeletonText lines={2} />
      </div>
      <div className="skeleton-bank-stats">
        <SkeletonText lines={2} />
        <SkeletonText lines={2} />
      </div>
    </SkeletonPulse>
  );
});

// Credit card skeleton (Apple Wallet style)
export const SkeletonCreditCard = React.memo(function SkeletonCreditCard({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-credit-card ${className}`}>
      <div className="skeleton-cc-header">
        <SkeletonBlock className="skeleton-cc-bank" />
      </div>
      <SkeletonBlock className="skeleton-cc-number" />
      <div className="skeleton-cc-footer">
        <SkeletonBlock className="skeleton-cc-name" />
        <SkeletonBlock className="skeleton-cc-expiry" />
      </div>
    </SkeletonPulse>
  );
});

// Transaction row skeleton
export const SkeletonTransactionRow = React.memo(function SkeletonTransactionRow({ className = "" }: { className?: string }) {
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

// Table row skeleton
export const SkeletonTableRow = React.memo(function SkeletonTableRow({ cols = 4, className = "" }: { cols?: number; className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-table-row ${className}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBlock key={i} className={`skeleton-table-cell skeleton-col-${i}`} />
      ))}
    </SkeletonPulse>
  );
});

// Hero card skeleton
export const SkeletonHeroCard = React.memo(function SkeletonHeroCard({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-hero ${className}`}>
      <SkeletonText lines={2} />
      <SkeletonBlock className="skeleton-hero-amount" />
      <div className="skeleton-hero-chips">
        <SkeletonBlock className="skeleton-chip" />
        <SkeletonBlock className="skeleton-chip" />
      </div>
    </SkeletonPulse>
  );
});

// Mini stat card skeleton - matches bank selector row content (no card wrapper since parent already has styles)
export const SkeletonMiniCard = React.memo(function SkeletonMiniCard({ className = "" }: { className?: string }) {
  return (
    <div className={`skeleton-pulse ${className}`} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <SkeletonBlock style={{ width: "44px", height: "24px", borderRadius: "4px", flexShrink: 0 }} />
      <SkeletonBlock style={{ height: "18px", width: "100px" }} />
    </div>
  );
});

// Full page loading state
export const PageLoadingState = React.memo(function PageLoadingState({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-loading">
      <div className="page-loading-spinner" />
      {children}
    </div>
  );
});

// Grid of skeleton cards
export const SkeletonGrid = React.memo(function SkeletonGrid({ count = 4, type = "card" }: { count?: number; type?: "card" | "bank" | "credit" | "mini" }) {
  const Component = type === "bank" ? SkeletonBankCard : type === "credit" ? SkeletonCreditCard : type === "mini" ? SkeletonMiniCard : SkeletonCard;
  return (
    <div className={`skeleton-grid skeleton-grid-${type}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
      ))}
    </div>
  );
});

// List of skeleton rows
export const SkeletonList = React.memo(function SkeletonList({ count = 5, type = "transaction" }: { count?: number; type?: "transaction" | "table" }) {
  const Component = type === "table" ? SkeletonTableRow : SkeletonTransactionRow;
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
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
export const DashboardSkeleton = React.memo(function DashboardSkeleton() {
  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {/* Bank selector - use actual bank-selector-row container, only skeleton content inside */}
      <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
        <SkeletonPulse style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <SkeletonBlock style={{ width: "44px", height: "24px", borderRadius: "4px", flexShrink: 0 }} />
          <SkeletonBlock style={{ height: "18px", width: "100px" }} />
        </SkeletonPulse>
      </div>

      {/* Net Worth strip */}
      <SkeletonPulse className="skeleton-dashboard-strip">
        <div style={{ display: "flex", alignItems: "center", gap: "16px", width: "100%" }}>
          <div style={{ flex: 1 }}>
            <div className="skeleton-block" style={{ height: "11px", width: "70px", marginBottom: "2px" }} />
            <div className="skeleton-block" style={{ height: "22px", width: "140px", marginBottom: "4px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px" }}>📈</span>
              <div className="skeleton-block" style={{ height: "13px", width: "80px" }} />
              <span style={{ color: "var(--text-tertiary)" }}>+</span>
              <span style={{ fontSize: "12px" }}>🐷</span>
              <div className="skeleton-block" style={{ height: "13px", width: "60px" }} />
            </div>
          </div>
          <div style={{ paddingLeft: "16px", borderLeft: "1px solid var(--border-subtle)", textAlign: "center", minWidth: "80px" }}>
            <div className="skeleton-block" style={{ height: "11px", width: "60px", marginBottom: "2px" }} />
            <div className="skeleton-block" style={{ height: "16px", width: "70px", marginBottom: "2px" }} />
            <div className="skeleton-block" style={{ height: "11px", width: "40px" }} />
          </div>
        </div>
      </SkeletonPulse>

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
          <SkeletonList count={3} type="transaction" />
        </div>
      </div>
    </div>
  );
});

// Transactions page specific skeleton
export const TransactionsSkeleton = React.memo(function TransactionsSkeleton() {
  return (
    <div style={{ display: "grid", gap: "14px" }}>
      {/* Bank selector - matches bank-selector-row */}
      <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
        <div className="skeleton-pulse" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <SkeletonBlock style={{ width: "44px", height: "24px", borderRadius: "4px", flexShrink: 0 }} />
          <SkeletonBlock style={{ height: "18px", width: "100px" }} />
        </div>
      </div>

      {/* Action Buttons - Transfer + Add Transaction */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
        <SkeletonBlock style={{ flex: 1, height: "40px", borderRadius: "var(--r-md)" }} />
        <SkeletonBlock style={{ flex: 1, height: "40px", borderRadius: "var(--r-md)" }} />
      </div>

      {/* Sub-Accounts section */}
      <div className="card" style={{ padding: "18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
          <SkeletonBlock style={{ height: "16px", width: "100px" }} />
          <SkeletonBlock style={{ height: "16px", width: "60px" }} />
        </div>
        <div className="account-cards-grid tx-account-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          <div className="budget-mini budget-mini-compact" style={{ minHeight: "68px", padding: "10px 12px" }}>
            <div className="skeleton-pulse" style={{ height: "100%" }}>
              <SkeletonBlock style={{ height: "12px", width: "70px", marginBottom: "4px" }} />
              <SkeletonBlock style={{ height: "16px", width: "50px" }} />
            </div>
          </div>
          <div className="budget-mini budget-mini-compact" style={{ minHeight: "68px", padding: "10px 12px" }}>
            <div className="skeleton-pulse" style={{ height: "100%" }}>
              <SkeletonBlock style={{ height: "12px", width: "70px", marginBottom: "4px" }} />
              <SkeletonBlock style={{ height: "16px", width: "50px" }} />
            </div>
          </div>
          <div className="budget-mini budget-mini-compact" style={{ minHeight: "68px", padding: "10px 12px" }}>
            <div className="skeleton-pulse" style={{ height: "100%" }}>
              <SkeletonBlock style={{ height: "12px", width: "70px", marginBottom: "4px" }} />
              <SkeletonBlock style={{ height: "16px", width: "50px" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions section */}
      <div className="card" style={{ padding: "18px 20px" }}>
        <SkeletonBlock style={{ height: "16px", width: "140px", marginBottom: "10px" }} />
        <SkeletonList count={5} type="transaction" />
      </div>
    </div>
  );
});

export const AppBodySkeleton = React.memo(function AppBodySkeleton() {
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

// Progress bar with animation for long-running operations
export const ProgressBar = React.memo(function ProgressBar({
  progress,
  label,
  className = "",
}: {
  progress: number; // 0-100
  label?: string;
  className?: string;
}) {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  return (
    <div className={`progress-container ${className}`}>
      {label && <div className="progress-label">{label}</div>}
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
});

// Animated generating state with spinner and progress
export const GeneratingState = React.memo(function GeneratingState({
  title = "Generating...",
  progress,
  current,
  total,
}: {
  title?: string;
  progress?: number;
  current?: number;
  total?: number;
}) {
  return (
    <div className="generating-state">
      <div className="generating-spinner" />
      <div className="generating-content">
        <div className="generating-title">{title}</div>
        {typeof progress === "number" && (
          <ProgressBar progress={progress} />
        )}
        {typeof current === "number" && typeof total === "number" && (
          <div className="generating-count">
            {current} of {total}
          </div>
        )}
      </div>
    </div>
  );
});
