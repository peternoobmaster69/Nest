"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { closeOnBackdropClick } from "@/lib/modal-dismiss";
import { useTheme } from "./theme-provider";
import { useConfirmDialog } from "./confirm-dialog";
import { SidebarSkeleton } from "./ui-skeleton";
import { purgePrivateServiceWorkerCaches } from "@/lib/service-worker-cache";
import { workspaceFetch } from "@/lib/workspace-client";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import {
  ChartNoAxesCombined,
  ChartPie,
  CreditCard,
  Gift,
  Home,
  ListChecks,
  LogOut,
  Moon,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
  Undo2,
} from "lucide-react";
import { invalidateWorkspaceQueries, queryKeys, removeWorkspaceQueries } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";

type Workspace = {
  id: string;
  name: string;
  baseCurrency: string;
  role: string;
};

type ReceivablesSummary = {
  count: number;
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppSidebar({
  userName,
  userEmail,
  userImage,
  currentPath,
  badgeCounts,
  sidebarOpen,
  onSidebarChange,
  contextData,
  contextLoading,
}: {
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  currentPath: string;
  badgeCounts?: {
    budgets?: number;
    receivables?: number;
  };
  sidebarOpen?: boolean;
  onSidebarChange?: (open: boolean) => void;
  contextData?: {
    workspaceId?: string | null;
    isShared?: boolean;
    isCollaborative?: boolean;
    workspaceName?: string | null;
    memberCount?: number;
    pendingInviteCount?: number;
    sidebarMoneyPages?: Record<string, boolean>;
    isAdmin?: boolean;
  };
  contextLoading?: boolean;
}) {
  const routeWorkspaceId = useWorkspaceId();
  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: async () => {
      const res = await workspaceFetch("/api/context");
      if (!res.ok) throw new Error("Failed to load context");
      return res.json() as Promise<{
        workspaceId?: string | null;
        isShared?: boolean;
        isCollaborative?: boolean;
        workspaceName?: string | null;
        memberCount?: number;
        pendingInviteCount?: number;
        sidebarMoneyPages?: Record<string, boolean>;
        isAdmin?: boolean;
      }>;
    },
    enabled: !contextData,
  });

  const resolvedContext = contextData ?? context.data;
  const receivablesSummary = useQuery({
    queryKey: queryKeys.key(["receivables-summary", resolvedContext?.workspaceId]),
    queryFn: async () => {
      const res = await workspaceFetch(`/api/receivables/summary?workspaceId=${resolvedContext?.workspaceId}`);
      if (!res.ok) throw new Error("Failed to load receivables summary");
      return res.json() as Promise<ReceivablesSummary>;
    },
    enabled: Boolean(resolvedContext?.workspaceId),
  });
  const isContextLoading = contextLoading || (!contextData && context.isLoading);
  const resolvedReceivablesCount = badgeCounts?.receivables ?? receivablesSummary.data?.count ?? 0;

  // Get sidebar visibility settings with defaults
  const sidebarMoneyPages = resolvedContext?.sidebarMoneyPages ?? {
    creditCards: true,
    creditTransactions: true,
    receivables: true,
    transactions: true,
    rewards: true,
    investments: true,
  };
  const showCreditCards = sidebarMoneyPages.creditCards !== false;
  const showCreditTransactions = showCreditCards && sidebarMoneyPages.creditTransactions !== false;

  const [internalSidebarOpen, setInternalSidebarOpen] = useState(false);
  const isOpen = sidebarOpen ?? internalSidebarOpen;
  const setIsOpen = onSidebarChange ?? setInternalSidebarOpen;

  const { theme, toggleTheme } = useTheme();
  const { confirm } = useConfirmDialog();

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const avatarAlt = userName || userEmail || "User";
  const navigationWorkspaceId = resolvedContext?.workspaceId ?? routeWorkspaceId;
  const workspaceHref = (path: string) =>
    navigationWorkspaceId ? buildWorkspacePath(navigationWorkspaceId, path) : path;

  // Fetch all workspaces for switching
  const workspacesQuery = useQuery({
    queryKey: queryKeys.key(["workspaces"]),
    queryFn: async () => {
      const res = await workspaceFetch("/api/workspaces");
      if (!res.ok) throw new Error("Failed to load workspaces");
      return res.json() as Promise<Workspace[]>;
    },
    enabled: profileMenuOpen,
  });

  useEffect(() => {
    if (!isOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!sidebarRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      profileMenuRef.current?.querySelector<HTMLElement>(".sb-user-menu a[href],.sb-user-menu button:not([disabled])")?.focus();
    });
    const onClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", onClick);
    };
  }, [profileMenuOpen]);

  const handleNavClick = () => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 1280px)").matches) {
      setIsOpen(false);
      window.sessionStorage.setItem("nest:ui:sidebarOpen", "0");
    }
  };

  const confirmLogout = async () => {
    setProfileMenuOpen(false);
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

  const switchWorkspace = async (workspaceId: string) => {
    if (workspaceId === resolvedContext?.workspaceId) return;
    const nextWorkspace = workspacesQuery.data?.find((workspace) => workspace.id === workspaceId) ?? null;
    setSwitchingWorkspaceId(workspaceId);
    setIsTransitioning(true);
    setProfileMenuOpen(false);
    try {
      const res = await workspaceFetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error("Failed to switch workspace");

      queryClient.setQueryData(queryKeys.context(workspaceId), (existing: {
        workspaceId?: string | null;
        workspaceName?: string | null;
      } | undefined) =>
        existing
          ? {
              ...existing,
              workspaceId,
              workspaceName: nextWorkspace?.name ?? existing.workspaceName,
            }
          : existing,
      );

      removeWorkspaceQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.contextAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.all("workspaces") });
      void invalidateWorkspaceQueries(queryClient, workspaceId);

      router.push(buildWorkspacePath(workspaceId));
      setTimeout(() => {
        setIsTransitioning(false);
        setSwitchingWorkspaceId(null);
      }, 180);
    } catch {
      setSwitchingWorkspaceId(null);
      setIsTransitioning(false);
    }
  };

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setIsOpen(false))} />}
      <aside ref={sidebarRef} className={`sidebar${isOpen ? " open" : ""}`} aria-label="Primary navigation">
        <div className="sb-logo-row">
          <Link href={workspaceHref("/")} className="sb-logo" onClick={handleNavClick}>
            <Image src="/icon.svg" alt="" width={30} height={30} className="brand-logo-sm" />
            <span>Nest</span>
          </Link>
          <Button
            className="sidebar-close"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(false);
            }}
            aria-label="Close sidebar"
          >
            ✕
          </Button>
        </div>

        {isContextLoading ? (
          <SidebarSkeleton />
        ) : (
          <>
      <div className="sb-scroll">
        <div className="sb-sec">Overview</div>
        <Link className={`sb-item${currentPath === "/" ? " on" : ""}`} href={workspaceHref("/")} onClick={handleNavClick} aria-current={currentPath === "/" ? "page" : undefined}>
          <Home className="sb-ic" size={18} aria-hidden="true" />Dashboard
        </Link>

        <div className="sb-sec">Money</div>
        {sidebarMoneyPages.transactions !== false && (
          <Link className={`sb-item${currentPath === "/transactions" ? " on" : ""}`} href={workspaceHref("/transactions")} onClick={handleNavClick} aria-current={currentPath === "/transactions" ? "page" : undefined}>
            <ReceiptText className="sb-ic" size={18} aria-hidden="true" />Transactions
          </Link>
        )}
        {showCreditCards && (
          <Link className={`sb-item${currentPath === "/credit-cards" ? " on" : ""}`} href={workspaceHref("/credit-cards")} onClick={handleNavClick} aria-current={currentPath === "/credit-cards" ? "page" : undefined}>
            <CreditCard className="sb-ic" size={18} aria-hidden="true" />Credit Cards
          </Link>
        )}
        {showCreditTransactions && (
          <Link className={`sb-item${currentPath === "/credit-transactions" ? " on" : ""}`} href={workspaceHref("/credit-transactions")} onClick={handleNavClick} aria-current={currentPath === "/credit-transactions" ? "page" : undefined}>
            <ListChecks className="sb-ic" size={18} aria-hidden="true" />Card Transactions
          </Link>
        )}
        {sidebarMoneyPages.receivables !== false && (
          <Link className={`sb-item${currentPath === "/receivables" ? " on" : ""}`} href={workspaceHref("/receivables")} onClick={handleNavClick}>
            <Undo2 className="sb-ic" size={18} aria-hidden="true" />Receivables
            {resolvedReceivablesCount ? <span className="sb-badge">{resolvedReceivablesCount}</span> : null}
          </Link>
        )}
        {sidebarMoneyPages.rewards !== false && (
          <Link className={`sb-item${currentPath === "/rewards" ? " on" : ""}`} href={workspaceHref("/rewards")} onClick={handleNavClick}>
            <Gift className="sb-ic" size={18} aria-hidden="true" />Rewards
          </Link>
        )}
        {sidebarMoneyPages.investments !== false && (
          <Link className={`sb-item${currentPath === "/investments" ? " on" : ""}`} href={workspaceHref("/investments")} onClick={handleNavClick}>
            <ChartNoAxesCombined className="sb-ic" size={18} aria-hidden="true" />Investments
          </Link>
        )}
        <Link className={`sb-item${currentPath === "/budgets/plan" ? " on" : ""}`} href={workspaceHref("/budgets/plan")} onClick={handleNavClick}>
          <ChartPie className="sb-ic" size={18} aria-hidden="true" />Budget Plan
        </Link>

        <div className="sb-sec">Workspace</div>
        <Link className={`sb-item${currentPath === "/settings" ? " on" : ""}`} href={workspaceHref("/settings")} onClick={handleNavClick}>
          <Settings className="sb-ic" size={18} aria-hidden="true" />Settings
        </Link>
        {resolvedContext?.isAdmin ? (
          <Link className={`sb-item${currentPath === "/admin" ? " on" : ""}`} href={workspaceHref("/admin")} onClick={handleNavClick}>
            <ShieldCheck className="sb-ic" size={18} aria-hidden="true" />Admin
          </Link>
        ) : null}

        {/* Mobile-only logout button */}
        <Button className="sb-item sb-logout-mobile" onClick={() => void confirmLogout()}>
          <LogOut className="sb-ic" size={18} aria-hidden="true" />Log Out
        </Button>
      </div>

      <div className="sb-bot">
        <div className="sb-user-wrap" ref={profileMenuRef}>
          <Button className="sb-user" onClick={() => setProfileMenuOpen((open) => !open)}>
            {userImage ? (
              <Image src={userImage} alt={avatarAlt} width={36} height={36} className="avatar avatar-md avatar-image" />
            ) : (
              <div className="avatar avatar-md avatar-green">{getInitials(userName)}</div>
            )}
            <div className="sb-user-meta">
              <span className="sb-user-name">{userName}</span>
              <span className="sb-user-sub">
                {resolvedContext?.isShared ? "👥" : "🔒"}{" "}
                {resolvedContext?.workspaceName || "Workspace"}
              </span>
            </div>
            <span className={`sb-user-chevron${profileMenuOpen ? " open" : ""}`}>▾</span>
          </Button>
          {profileMenuOpen && (
            <div className="sb-user-menu">
              <Link
                className="sb-user-menu-item"
                href={workspaceHref("/profile")}
                onClick={() => {
                  setProfileMenuOpen(false);
                  if (window.matchMedia("(max-width: 1280px)").matches) {
                    setIsOpen(false);
                    window.sessionStorage.setItem("nest:ui:sidebarOpen", "0");
                  }
                }}
              >
                View Profile
              </Link>
              <Button
                className="sb-user-menu-item sb-user-menu-theme"
                onClick={() => {
                  setProfileMenuOpen(false);
                  toggleTheme();
                }}
              >
                {theme === "light" ? <><Moon size={16} aria-hidden="true" /> Dark mode</> : <><Sun size={16} aria-hidden="true" /> Light mode</>}
              </Button>
              <div className="sb-user-menu-divider" />
              <div className="sb-user-menu-section">Switch Workspace</div>
              {workspacesQuery.isLoading ? (
                <div className="sb-user-menu-item sb-user-menu-loading">
                  <span className="sb-workspace-spinner" />
                  Loading...
                </div>
              ) : (
                workspacesQuery.data?.map((ws) => {
                  const isCurrent = ws.id === resolvedContext?.workspaceId;
                  const isSwitching = switchingWorkspaceId === ws.id;
                  return (
                    <Button
                      key={ws.id}
                      className={`sb-user-menu-item sb-user-menu-workspace${isCurrent ? " active" : ""}${isSwitching ? " switching" : ""}`}
                      onClick={() => switchWorkspace(ws.id)}
                      disabled={isCurrent || isSwitching}
                    >
                      <span className="sb-workspace-icon">
                        {isSwitching ? <span className="sb-workspace-spinner" /> : isCurrent ? "✓" : "○"}
                      </span>
                      <span className="sb-workspace-name">{ws.name}</span>
                    </Button>
                  );
                })
              )}
              <div className="sb-user-menu-divider" />
              <Button className="sb-user-menu-item" onClick={() => void confirmLogout()}>
                Log Out
              </Button>
            </div>
          )}
        </div>
      </div>
          </>
        )}

      </aside>

      {/* Workspace Transition Overlay */}
      {isTransitioning && (
        <div className="workspace-transition-overlay">
          <div className="workspace-transition-content">
            <div className="workspace-transition-spinner" />
            <span className="workspace-transition-text">Switching workspace...</span>
          </div>
        </div>
      )}
    </>
  );
}
