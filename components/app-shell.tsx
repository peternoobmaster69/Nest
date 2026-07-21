"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUp,
  ChartNoAxesCombined,
  ChartPie,
  CreditCard,
  Ellipsis,
  Gift,
  Home,
  ListChecks,
  Menu,
  ReceiptText,
  Settings,
  Undo2,
  Users,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { MobileAccountPanel } from "@/components/mobile-account-panel";
import { AskNest } from "@/components/ask-nest";
import { getMotionSafeScrollBehavior } from "@/lib/motion";

const SCROLL_TO_TOP_MIN_OFFSET = 480;

const MOBILE_DATE_FORMATTER = new Intl.DateTimeFormat("en-SG", {
  day: "2-digit",
  month: "short",
});

function getMobileDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    dateTime: `${year}-${month}-${day}`,
    label: MOBILE_DATE_FORMATTER.format(date),
  };
}

export type AppShellContext = {
  workspaceId?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
  isAdmin?: boolean;
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
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileMoreView, setMobileMoreView] = useState<"navigation" | "account">("navigation");
  const [mobileCurrentDate, setMobileCurrentDate] = useState<{ dateTime: string; label: string } | null>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileMoreRef = useRef<HTMLElement | null>(null);
  const mobileMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarMoneyPages = contextData?.sidebarMoneyPages ?? {
    creditCards: true,
    creditTransactions: true,
    receivables: true,
    transactions: true,
    rewards: true,
    investments: true,
  };
  const showTransactions = sidebarMoneyPages.transactions !== false;
  const showCreditCards = sidebarMoneyPages.creditCards !== false;
  const showCreditTransactions = showCreditCards && sidebarMoneyPages.creditTransactions !== false;
  const showInvestments = sidebarMoneyPages.investments !== false;
  const primaryCardsPath = showCreditTransactions ? "/credit-transactions" : "/credit-cards";
  const cardsRouteActive = currentPath === "/credit-cards" || currentPath === "/credit-transactions";
  const mobileWorkspaceName = contextData?.workspaceName?.trim();
  const moreRouteActive = [
    "/receivables",
    "/rewards",
    "/budgets",
    "/collaborators",
    "/settings",
    "/admin",
  ].some((path) => currentPath === path || currentPath.startsWith(`${path}/`));

  useEffect(() => {
    const workspaceName = contextData?.workspaceName?.trim();
    document.title = workspaceName ? `${workspaceName} · ${title}` : `${title} · Nest`;
  }, [contextData?.workspaceName, title]);

  useEffect(() => {
    let timeoutId: number | undefined;
    const updateCurrentDate = () => {
      const now = new Date();
      setMobileCurrentDate(getMobileDate(now));
      const nextDay = new Date(now);
      nextDay.setHours(24, 0, 1, 0);
      timeoutId = window.setTimeout(updateCurrentDate, Math.max(1000, nextDay.getTime() - now.getTime()));
    };
    updateCurrentDate();
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    setMobileMoreOpen(false);
    setMobileMoreView("navigation");
  }, [currentPath]);

  useEffect(() => {
    const scrollContainer = bodyScrollRef.current;
    if (!scrollContainer) return;

    let animationFrame = 0;
    const updateVisibility = () => {
      animationFrame = 0;
      const isLongPage = scrollContainer.scrollHeight > scrollContainer.clientHeight * 1.5;
      const revealOffset = Math.max(SCROLL_TO_TOP_MIN_OFFSET, scrollContainer.clientHeight * 0.75);
      setShowScrollToTop(isLongPage && scrollContainer.scrollTop > revealOffset);
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    scrollContainer.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [currentPath]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      mobileMoreRef.current?.querySelector<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])")?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !mobileMoreRef.current?.contains(event.target) &&
        !mobileMoreButtonRef.current?.contains(event.target)
      ) {
        setMobileMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMoreOpen(false);
        return;
      }
      if (event.key !== "Tab" || !mobileMoreRef.current) return;
      const focusable = Array.from(
        mobileMoreRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])"),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.documentElement.dataset.mobileMoreOpen = "true";
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      delete document.documentElement.dataset.mobileMoreOpen;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [mobileMoreOpen]);

  const closeMobileNavigation = () => {
    setMobileMoreOpen(false);
    setMobileMoreView("navigation");
    setSidebarOpen(false);
  };

  const scrollToTop = () => {
    bodyScrollRef.current?.scrollTo({ top: 0, behavior: getMotionSafeScrollBehavior() });
    mainRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
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
      <main ref={mainRef} className="main" id="main-content" tabIndex={-1}>
        <header className="topbar">
          <div className="tb-left">
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
              <Menu size={20} aria-hidden="true" />
            </button>
            <div className="mobile-topbar-title">{title}</div>
            <div className="desktop-topbar-content">
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
          </div>
          <div className="tb-actions">
            <AskNest
              currentPath={currentPath}
              pageTitle={title}
              workspaceName={contextData?.workspaceName}
              userName={userName}
            />
            <NotificationBell workspaceId={contextData?.workspaceId} />
          </div>
        </header>
        <div ref={bodyScrollRef} className="body">{children}</div>
      </main>

      <button
        type="button"
        className={`scroll-to-top-button${showScrollToTop ? " is-visible" : ""}`}
        onClick={scrollToTop}
        aria-label="Scroll to top"
        title="Back to top"
        aria-hidden={!showScrollToTop}
        tabIndex={showScrollToTop ? 0 : -1}
      >
        <ArrowUp size={20} aria-hidden="true" />
      </button>

      {mobileMoreOpen ? (
        <>
          <div className="mobile-more-backdrop" aria-hidden="true" />
          <section id="mobile-more-menu" ref={mobileMoreRef} className="mobile-more-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">
            <div className="mobile-more-header">
              <div className="mobile-more-header-main">
                {mobileMoreView === "account" ? (
                  <button className="mobile-more-back" type="button" onClick={() => setMobileMoreView("navigation")} aria-label="Back to More navigation" autoFocus>
                    <ArrowLeft size={19} aria-hidden="true" />
                  </button>
                ) : null}
                <div>
                  <h2 id="mobile-more-title">{mobileMoreView === "account" ? "Account" : "More"}</h2>
                  <p>{contextData?.workspaceName || "Workspace"}</p>
                </div>
              </div>
              <ModalCloseButton onClick={() => setMobileMoreOpen(false)} label="Close More navigation" />
            </div>
            {mobileMoreView === "navigation" ? (
              <>
                <nav className="mobile-more-links" aria-label="More navigation">
              {showCreditTransactions ? (
                <Link className={`mobile-more-link${currentPath === "/credit-cards" ? " is-active" : ""}`} href="/credit-cards" onClick={closeMobileNavigation}>
                  <CreditCard size={20} aria-hidden="true" />
                  <span><strong>Credit Cards</strong><small>Manage cards and card details</small></span>
                </Link>
              ) : null}
              {sidebarMoneyPages.receivables !== false ? (
                <Link className={`mobile-more-link${currentPath === "/receivables" ? " is-active" : ""}`} href="/receivables" onClick={closeMobileNavigation}>
                  <Undo2 size={20} aria-hidden="true" />
                  <span><strong>Receivables</strong><small>Track money owed to you</small></span>
                  {badgeCounts?.receivables ? <span className="mobile-more-badge">{badgeCounts.receivables}</span> : null}
                </Link>
              ) : null}
              {sidebarMoneyPages.rewards !== false ? (
                <Link className={`mobile-more-link${currentPath === "/rewards" ? " is-active" : ""}`} href="/rewards" onClick={closeMobileNavigation}>
                  <Gift size={20} aria-hidden="true" />
                  <span><strong>Rewards</strong><small>Cards, miles, and hotel points</small></span>
                </Link>
              ) : null}
              <Link className={`mobile-more-link${currentPath.startsWith("/budgets") ? " is-active" : ""}`} href="/budgets/plan" onClick={closeMobileNavigation}>
                <ChartPie size={20} aria-hidden="true" />
                <span><strong>Budget</strong><small>Plan monthly sources and spending</small></span>
                {badgeCounts?.budgets ? <span className="mobile-more-badge">{badgeCounts.budgets}</span> : null}
              </Link>
              <Link className={`mobile-more-link${currentPath === "/collaborators" ? " is-active" : ""}`} href="/collaborators" onClick={closeMobileNavigation}>
                <Users size={20} aria-hidden="true" />
                <span><strong>Workspaces</strong><small>Members and workspace access</small></span>
              </Link>
              <Link className={`mobile-more-link${currentPath === "/settings" ? " is-active" : ""}`} href="/settings" onClick={closeMobileNavigation}>
                <Settings size={20} aria-hidden="true" />
                <span><strong>Settings</strong><small>Accounts and preferences</small></span>
              </Link>
              {contextData?.isAdmin ? (
                <Link className={`mobile-more-link${currentPath === "/admin" ? " is-active" : ""}`} href="/admin" onClick={closeMobileNavigation}>
                  <ShieldCheck size={20} aria-hidden="true" />
                  <span><strong>Admin</strong><small>System and Ask Nest oversight</small></span>
                </Link>
              ) : null}
                </nav>
                <button className="mobile-more-account" type="button" onClick={() => setMobileMoreView("account")}>
                  <span className="mobile-more-account-icon"><UserRound size={19} aria-hidden="true" /></span>
                  <span><strong>{userName || "Account"}</strong><small>Profile, appearance, and workspace</small></span>
                </button>
              </>
            ) : (
              <MobileAccountPanel
                userName={userName}
                userEmail={userEmail}
                userImage={userImage}
                workspaceId={contextData?.workspaceId}
                workspaceName={contextData?.workspaceName}
                onDisplayNameUpdated={onDisplayNameUpdated}
                onClose={closeMobileNavigation}
              />
            )}
          </section>
        </>
      ) : null}

      <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
        <Link className={`mobile-bottom-nav-item${currentPath === "/" ? " is-active" : ""}`} href="/" onClick={closeMobileNavigation} aria-current={currentPath === "/" ? "page" : undefined}>
          <Home size={21} aria-hidden="true" />
          <span>Home</span>
        </Link>
        {showTransactions ? (
          <Link className={`mobile-bottom-nav-item${currentPath === "/transactions" ? " is-active" : ""}`} href="/transactions" onClick={closeMobileNavigation} aria-current={currentPath === "/transactions" ? "page" : undefined}>
            <ReceiptText size={21} aria-hidden="true" />
            <span>Transactions</span>
          </Link>
        ) : null}
        {showCreditCards ? (
          <Link className={`mobile-bottom-nav-item${cardsRouteActive ? " is-active" : ""}`} href={primaryCardsPath} onClick={closeMobileNavigation} aria-current={cardsRouteActive ? "page" : undefined}>
            {showCreditTransactions ? <ListChecks size={21} aria-hidden="true" /> : <CreditCard size={21} aria-hidden="true" />}
            <span>Cards</span>
          </Link>
        ) : null}
        {showInvestments ? (
          <Link className={`mobile-bottom-nav-item${currentPath === "/investments" ? " is-active" : ""}`} href="/investments" onClick={closeMobileNavigation} aria-current={currentPath === "/investments" ? "page" : undefined}>
            <ChartNoAxesCombined size={21} aria-hidden="true" />
            <span>Investments</span>
          </Link>
        ) : null}
        <button
          ref={mobileMoreButtonRef}
          type="button"
          className={`mobile-bottom-nav-item${mobileMoreOpen || moreRouteActive ? " is-active" : ""}`}
          onClick={() => {
            setMobileMoreView("navigation");
            setMobileMoreOpen((open) => !open);
          }}
          aria-expanded={mobileMoreOpen}
          aria-haspopup="dialog"
          aria-controls="mobile-more-menu"
          aria-label={mobileMoreOpen ? "Close More menu" : "Open More menu"}
        >
          <Ellipsis size={22} aria-hidden="true" />
          <span>More</span>
        </button>
        {mobileWorkspaceName || mobileCurrentDate ? (
          <div className="mobile-bottom-nav-workspace">
            {mobileWorkspaceName ? (
              <span
                className="mobile-bottom-nav-workspace-name"
                aria-label={`Current workspace: ${mobileWorkspaceName}`}
                title={mobileWorkspaceName}
              >
                {mobileWorkspaceName.toUpperCase()}
              </span>
            ) : null}
            {mobileWorkspaceName && mobileCurrentDate ? (
              <span className="mobile-bottom-nav-workspace-separator" aria-hidden="true" />
            ) : null}
            {mobileCurrentDate ? (
              <time
                className="mobile-bottom-nav-workspace-name"
                dateTime={mobileCurrentDate.dateTime}
                aria-label={`Today: ${mobileCurrentDate.label}`}
              >
                {mobileCurrentDate.label}
              </time>
            ) : null}
          </div>
        ) : null}
      </nav>
    </div>
  );
}
