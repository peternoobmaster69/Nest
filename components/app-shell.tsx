"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  ChartNoAxesCombined,
  ChartPie,
  Check,
  ChevronDown,
  CreditCard,
  Ellipsis,
  Gift,
  Home,
  Layers3,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  Settings,
  Sun,
  Undo2,
  ShieldCheck,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { AskNest } from "@/components/ask-nest";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useTheme } from "@/components/theme-provider";
import { getMotionSafeScrollBehavior } from "@/lib/motion";
import { purgePrivateServiceWorkerCaches } from "@/lib/service-worker-cache";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import { workspaceFetch } from "@/lib/workspace-client";
import { useWorkspaceId } from "@/components/workspace-provider";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import type { AppShellContext } from "@/components/app-shell-context";
import { WorkspaceSetupGuideBoundary } from "@/components/onboarding/workspace-setup-guide-boundary";

const SCROLL_TO_TOP_MIN_OFFSET = 480;

type WorkspaceOption = {
  id: string;
  name: string;
  baseCurrency: string;
  role: string;
};

type ReceivablesSummary = {
  count: number;
};

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

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell({
  title,
  currentPath,
  userName,
  userEmail,
  userImage,
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
  badgeCounts?: { budgets?: number; receivables?: number };
  contextData?: AppShellContext;
  contextLoading?: boolean;
  topbarTitle?: ReactNode;
  children: ReactNode;
}) {
  const routeWorkspaceId = useWorkspaceId();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [workspaceChooserOpen, setWorkspaceChooserOpen] = useState(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [mobileCurrentDate, setMobileCurrentDate] = useState<{ dateTime: string; label: string } | null>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const { confirm } = useConfirmDialog();
  const { theme, toggleTheme } = useTheme();
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
    "/settings",
    "/profile",
    "/admin",
  ].some((path) => currentPath === path || currentPath.startsWith(`${path}/`));
  const navigationWorkspaceId = contextData?.workspaceId ?? routeWorkspaceId;
  const workspaceHref = (path: string) =>
    navigationWorkspaceId ? buildWorkspacePath(navigationWorkspaceId, path) : path;
  const workspacesQuery = useQuery({
    queryKey: queryKeys.key(["workspaces"]),
    queryFn: async () => {
      const response = await workspaceFetch("/api/workspaces");
      if (!response.ok) throw new Error("Failed to load workspaces");
      return response.json() as Promise<WorkspaceOption[]>;
    },
    enabled: mobileMoreOpen,
    staleTime: 60_000,
  });
  const receivablesSummary = useQuery({
    queryKey: queryKeys.key(["receivables-summary", navigationWorkspaceId]),
    queryFn: async () => {
      const response = await workspaceFetch(`/api/receivables/summary?workspaceId=${navigationWorkspaceId}`);
      if (!response.ok) throw new Error("Failed to load receivables summary");
      return response.json() as Promise<ReceivablesSummary>;
    },
    enabled: Boolean(navigationWorkspaceId),
  });
  const mobileReceivablesCount = badgeCounts?.receivables ?? receivablesSummary.data?.count ?? 0;

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
    setWorkspaceChooserOpen(false);
    setSwitchingWorkspaceId(null);
  }, [currentPath, routeWorkspaceId]);

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
    setWorkspaceChooserOpen(false);
    setSidebarOpen(false);
  };

  const confirmLogout = async () => {
    closeMobileNavigation();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const confirmed = await confirm({
      title: "Log out of Nest?",
      message: "You will need to sign in again to access your account on this device.",
      confirmLabel: "Log out",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!confirmed) return;
    await purgePrivateServiceWorkerCaches();
    await signOut({ callbackUrl: "/" });
  };

  const switchMobileWorkspace = async (nextWorkspaceId: string) => {
    if (!nextWorkspaceId || nextWorkspaceId === navigationWorkspaceId) return;
    const currentDestination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setSwitchingWorkspaceId(nextWorkspaceId);
    try {
      const response = await workspaceFetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: nextWorkspaceId }),
      });
      if (!response.ok) throw new Error("Failed to switch workspace");

      setWorkspaceChooserOpen(false);
      setMobileMoreOpen(false);
      router.push(buildWorkspacePath(nextWorkspaceId, currentDestination));
    } catch {
      setSwitchingWorkspaceId(null);
    }
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
            <Button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
              <Menu size={20} aria-hidden="true" />
            </Button>
            <div className="mobile-topbar-title">{title}</div>
            <div className="desktop-topbar-content">
              {topbarTitle || (currentPath === "/" ? (
                <div className="tb-title">{title}</div>
              ) : (
                <nav className="tb-breadcrumb" aria-label="Breadcrumb">
                  <ol className="breadcrumb-list">
                    <li className="breadcrumb-item">
                      <Link href={workspaceHref("/")} className="breadcrumb-link" aria-label="Dashboard">
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
              workspaceId={navigationWorkspaceId}
              userName={userName}
            />
            <NotificationBell workspaceId={navigationWorkspaceId} />
          </div>
        </header>
        <div ref={bodyScrollRef} className="body">{children}</div>
      </main>

      <Button
        type="button"
        className={`scroll-to-top-button${showScrollToTop ? " is-visible" : ""}`}
        onClick={scrollToTop}
        aria-label="Scroll to top"
        title="Back to top"
        aria-hidden={!showScrollToTop}
        tabIndex={showScrollToTop ? 0 : -1}
      >
        <ArrowUp size={20} aria-hidden="true" />
      </Button>

      {mobileMoreOpen ? (
        <>
          <div className="mobile-more-backdrop" aria-hidden="true" />
          <section id="mobile-more-menu" ref={mobileMoreRef} className="mobile-more-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">
            <div className="mobile-more-header">
              <div className="mobile-more-header-main">
                <div>
                  <h2 id="mobile-more-title">More</h2>
                  <p>{contextData?.workspaceName || "Workspace"}</p>
                </div>
              </div>
              <ModalCloseButton onClick={() => setMobileMoreOpen(false)} label="Close More navigation" />
            </div>
            <nav className="mobile-more-links" aria-label="More navigation">
              {showCreditTransactions ? (
                <Link className={`mobile-more-link${currentPath === "/credit-cards" ? " is-active" : ""}`} href={workspaceHref("/credit-cards")} onClick={closeMobileNavigation}>
                  <CreditCard size={20} aria-hidden="true" />
                  <span><strong>Credit Cards</strong><small>Manage cards and card details</small></span>
                </Link>
              ) : null}
              {sidebarMoneyPages.receivables !== false ? (
                <Link className={`mobile-more-link${currentPath === "/receivables" ? " is-active" : ""}`} href={workspaceHref("/receivables")} onClick={closeMobileNavigation}>
                  <Undo2 size={20} aria-hidden="true" />
                  <span><strong>Receivables</strong><small>Track money owed to you</small></span>
                  {mobileReceivablesCount ? <span className="mobile-more-badge">{mobileReceivablesCount}</span> : null}
                </Link>
              ) : null}
              {sidebarMoneyPages.rewards !== false ? (
                <Link className={`mobile-more-link${currentPath === "/rewards" ? " is-active" : ""}`} href={workspaceHref("/rewards")} onClick={closeMobileNavigation}>
                  <Gift size={20} aria-hidden="true" />
                  <span><strong>Rewards</strong><small>Cards, miles, and hotel points</small></span>
                </Link>
              ) : null}
              <Link className={`mobile-more-link${currentPath.startsWith("/budgets") ? " is-active" : ""}`} href={workspaceHref("/budgets/plan")} onClick={closeMobileNavigation}>
                <ChartPie size={20} aria-hidden="true" />
                <span><strong>Budget</strong><small>Plan monthly sources and spending</small></span>
              </Link>
              <Link className={`mobile-more-link${currentPath === "/settings" ? " is-active" : ""}`} href={workspaceHref("/settings")} onClick={closeMobileNavigation}>
                <Settings size={20} aria-hidden="true" />
                <span><strong>Settings</strong><small>Preferences and workspaces</small></span>
              </Link>
              {contextData?.isAdmin ? (
                <Link className={`mobile-more-link${currentPath === "/admin" ? " is-active" : ""}`} href={workspaceHref("/admin")} onClick={closeMobileNavigation}>
                  <ShieldCheck size={20} aria-hidden="true" />
                  <span><strong>Admin</strong><small>System and Ask Nest oversight</small></span>
                </Link>
              ) : null}
            </nav>
            <div className="mobile-more-workspace-switcher">
              <Button
                className={`mobile-more-link mobile-more-workspace-trigger${workspaceChooserOpen ? " is-active" : ""}`}
                type="button"
                onClick={() => setWorkspaceChooserOpen((open) => !open)}
                aria-expanded={workspaceChooserOpen}
                aria-controls="mobile-more-workspace-options"
              >
                <Layers3 size={20} aria-hidden="true" />
                <span>
                  <strong>{mobileWorkspaceName || "Workspace"}</strong>
                  <small>Switch workspace in this tab</small>
                </span>
                <ChevronDown className="mobile-more-workspace-chevron" size={17} aria-hidden="true" />
              </Button>
              {workspaceChooserOpen ? (
                <div id="mobile-more-workspace-options" className="mobile-more-workspace-options" role="listbox" aria-label="Workspaces">
                  {workspacesQuery.isLoading ? (
                    <div className="mobile-more-workspace-status"><span className="sb-workspace-spinner" /> Loading workspaces...</div>
                  ) : workspacesQuery.isError ? (
                    <div className="mobile-more-workspace-status">Workspaces could not be loaded.</div>
                  ) : workspacesQuery.data?.map((workspace) => {
                    const isCurrent = workspace.id === navigationWorkspaceId;
                    const isSwitching = workspace.id === switchingWorkspaceId;
                    return (
                      <Button
                        className={`mobile-more-workspace-option${isCurrent ? " is-current" : ""}`}
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        key={workspace.id}
                        onClick={() => void switchMobileWorkspace(workspace.id)}
                        disabled={isCurrent || isSwitching}
                      >
                        <span className="mobile-more-workspace-mark">
                          {isSwitching ? <span className="sb-workspace-spinner" /> : isCurrent ? <Check size={15} aria-hidden="true" /> : null}
                        </span>
                        <span><strong>{workspace.name}</strong><small>{workspace.baseCurrency}</small></span>
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <Button
              className="mobile-more-logout"
              type="button"
              onClick={() => void confirmLogout()}
            >
              <LogOut size={19} aria-hidden="true" />
              <span><strong>Log out</strong><small>Sign out of Nest on this device</small></span>
            </Button>
            <div className="mobile-more-account-row">
              <Link className="mobile-more-account" href={workspaceHref("/profile")} onClick={closeMobileNavigation}>
                {userImage ? (
                  <Image src={userImage} alt={userName || userEmail || "User"} width={38} height={38} className="avatar avatar-image mobile-more-account-avatar" />
                ) : (
                  <span className="avatar avatar-green mobile-more-account-avatar">{getInitials(userName)}</span>
                )}
                <span><strong>{userName || "Account"}</strong><small>View profile</small></span>
              </Link>
              <Button
                className="mobile-more-theme-toggle"
                type="button"
                onClick={toggleTheme}
                aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                title={theme === "light" ? "Dark mode" : "Light mode"}
              >
                {theme === "light" ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
              </Button>
            </div>
          </section>
        </>
      ) : null}

      <WorkspaceSetupGuideBoundary workspaceId={navigationWorkspaceId} context={contextData} />

      <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
        <Link className={`mobile-bottom-nav-item${currentPath === "/" ? " is-active" : ""}`} href={workspaceHref("/")} onClick={closeMobileNavigation} aria-current={currentPath === "/" ? "page" : undefined}>
          <Home size={21} aria-hidden="true" />
          <span>Home</span>
        </Link>
        {showTransactions ? (
          <Link className={`mobile-bottom-nav-item${currentPath === "/transactions" ? " is-active" : ""}`} href={workspaceHref("/transactions")} onClick={closeMobileNavigation} aria-current={currentPath === "/transactions" ? "page" : undefined}>
            <ReceiptText size={21} aria-hidden="true" />
            <span>Transactions</span>
          </Link>
        ) : null}
        {showCreditCards ? (
          <Link className={`mobile-bottom-nav-item${cardsRouteActive ? " is-active" : ""}`} href={workspaceHref(primaryCardsPath)} onClick={closeMobileNavigation} aria-current={cardsRouteActive ? "page" : undefined}>
            {showCreditTransactions ? <ListChecks size={21} aria-hidden="true" /> : <CreditCard size={21} aria-hidden="true" />}
            <span>Cards</span>
          </Link>
        ) : null}
        {showInvestments ? (
          <Link className={`mobile-bottom-nav-item${currentPath === "/investments" ? " is-active" : ""}`} href={workspaceHref("/investments")} onClick={closeMobileNavigation} aria-current={currentPath === "/investments" ? "page" : undefined}>
            <ChartNoAxesCombined size={21} aria-hidden="true" />
            <span>Investments</span>
          </Link>
        ) : null}
        <Button
          ref={mobileMoreButtonRef}
          type="button"
          className={`mobile-bottom-nav-item${mobileMoreOpen || moreRouteActive ? " is-active" : ""}`}
          onClick={() => {
            setMobileMoreOpen((open) => !open);
          }}
          aria-expanded={mobileMoreOpen}
          aria-haspopup="dialog"
          aria-controls="mobile-more-menu"
          aria-label={mobileMoreOpen ? "Close More menu" : "Open More menu"}
        >
          <Ellipsis size={22} aria-hidden="true" />
          <span>More</span>
        </Button>
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
