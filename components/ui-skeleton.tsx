"use client";

import React from "react";

// Skeleton pulse animation wrapper
function SkeletonPulse({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`skeleton-pulse ${className}`}>
      {children}
    </div>
  );
}

// Generic skeleton block
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton-block ${className}`} />;
}

// Text line skeleton
export function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`skeleton-text-group ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-text" style={{ width: i === lines - 1 && lines > 1 ? "70%" : "100%" }} />
      ))}
    </div>
  );
}

// Card skeleton
export function SkeletonCard({ className = "" }: { className?: string }) {
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
}

// Bank account card skeleton
export function SkeletonBankCard({ className = "" }: { className?: string }) {
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
}

// Credit card skeleton (Apple Wallet style)
export function SkeletonCreditCard({ className = "" }: { className?: string }) {
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
}

// Transaction row skeleton
export function SkeletonTransactionRow({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-tx-row ${className}`}>
      <SkeletonBlock className="skeleton-tx-icon" />
      <div className="skeleton-tx-details">
        <SkeletonText lines={2} />
      </div>
      <SkeletonBlock className="skeleton-tx-amount" />
    </SkeletonPulse>
  );
}

// Table row skeleton
export function SkeletonTableRow({ cols = 4, className = "" }: { cols?: number; className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-table-row ${className}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBlock key={i} className={`skeleton-table-cell skeleton-col-${i}`} />
      ))}
    </SkeletonPulse>
  );
}

// Hero card skeleton
export function SkeletonHeroCard({ className = "" }: { className?: string }) {
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
}

// Mini stat card skeleton
export function SkeletonMiniCard({ className = "" }: { className?: string }) {
  return (
    <SkeletonPulse className={`skeleton-mini ${className}`}>
      <SkeletonBlock className="skeleton-mini-icon" />
      <SkeletonText lines={2} />
    </SkeletonPulse>
  );
}

// Full page loading state
export function PageLoadingState({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-loading">
      <div className="page-loading-spinner" />
      {children}
    </div>
  );
}

// Grid of skeleton cards
export function SkeletonGrid({ count = 4, type = "card" }: { count?: number; type?: "card" | "bank" | "credit" | "mini" }) {
  const Component = type === "bank" ? SkeletonBankCard : type === "credit" ? SkeletonCreditCard : type === "mini" ? SkeletonMiniCard : SkeletonCard;
  return (
    <div className={`skeleton-grid skeleton-grid-${type}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
      ))}
    </div>
  );
}

// List of skeleton rows
export function SkeletonList({ count = 5, type = "transaction" }: { count?: number; type?: "transaction" | "table" }) {
  const Component = type === "table" ? SkeletonTableRow : SkeletonTransactionRow;
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <Component key={i} />
      ))}
    </div>
  );
}

export function SidebarSkeleton() {
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
}

export function AppBodySkeleton() {
  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <SkeletonHeroCard />
      <div className="grid-4">
        <SkeletonMiniCard />
        <SkeletonMiniCard />
        <SkeletonMiniCard />
        <SkeletonMiniCard />
      </div>
      <div className="card">
        <SkeletonList count={4} type="transaction" />
      </div>
    </div>
  );
}

export function AppShellSkeleton({ title = "Loading" }: { title?: string }) {
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
}

// Empty state component with icon and action
export function EmptyState({
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
}

// Loading overlay for buttons/actions
export function LoadingDots({ className = "" }: { className?: string }) {
  return (
    <span className={`loading-dots ${className}`}>
      <span />
      <span />
      <span />
    </span>
  );
}
