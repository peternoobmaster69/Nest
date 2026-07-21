"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { closeOnBackdropClick } from "@/lib/modal-dismiss";
import { useTheme } from "./theme-provider";
import { SidebarSkeleton } from "./ui-skeleton";
import { ModalCloseButton } from "./ui/modal-close-button";
import { purgePrivateServiceWorkerCaches } from "@/lib/service-worker-cache";
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
  Users,
} from "lucide-react";

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
  onDisplayNameUpdated,
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
  onDisplayNameUpdated?: (name: string) => void;
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
  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: async () => {
      const res = await fetch("/api/context");
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
    queryKey: ["receivables-summary", resolvedContext?.workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/receivables/summary?workspaceId=${resolvedContext?.workspaceId}`);
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

  const [displayName, setDisplayName] = useState(userName);
  const [editingName, setEditingName] = useState(userName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const avatarAlt = displayName || userName || userEmail || "User";

  // Fetch all workspaces for switching
  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces");
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
      profileMenuRef.current?.querySelector<HTMLButtonElement>(".sb-user-menu button:not([disabled])")?.focus();
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

  useEffect(() => {
    if (!profileModalOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileModalOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [profileModalOpen]);

  useEffect(() => {
    setDisplayName(userName);
    setEditingName(userName);
  }, [userName]);

  const saveDisplayName = async () => {
    const nextName = editingName.trim();
    if (!nextName) {
      setProfileError("Display name is required.");
      return;
    }

    setSavingProfile(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
      }

      setDisplayName(nextName);
      onDisplayNameUpdated?.(nextName);
      setProfileModalOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleNavClick = () => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 1280px)").matches) {
      setIsOpen(false);
      window.sessionStorage.setItem("nest:ui:sidebarOpen", "0");
    }
  };

  const switchWorkspace = async (workspaceId: string) => {
    if (workspaceId === resolvedContext?.workspaceId) return;
    const nextWorkspace = workspacesQuery.data?.find((workspace) => workspace.id === workspaceId) ?? null;
    setSwitchingWorkspaceId(workspaceId);
    setIsTransitioning(true);
    setProfileMenuOpen(false);
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error("Failed to switch workspace");

      queryClient.setQueryData(["app-context"], (existing: {
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

      queryClient.removeQueries({ queryKey: ["credit-transactions"] });
      queryClient.removeQueries({ queryKey: ["rewards"] });

      void queryClient.invalidateQueries({ queryKey: ["app-context"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      void queryClient.removeQueries({ queryKey: ["budgets"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["receivables"] });
      void queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["investments"] });
      void queryClient.invalidateQueries({ queryKey: ["credit-cards"] });
      void queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });

      router.push("/");
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
          <Link href="/" className="sb-logo" onClick={handleNavClick}>
            <Image src="/icon.svg" alt="" width={30} height={30} className="brand-logo-sm" />
            <span>Nest</span>
          </Link>
          <button
            className="sidebar-close"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(false);
            }}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        {isContextLoading ? (
          <SidebarSkeleton />
        ) : (
          <>
      <div className="sb-scroll">
        <div className="sb-sec">Overview</div>
        <Link className={`sb-item${currentPath === "/" ? " on" : ""}`} href="/" onClick={handleNavClick} aria-current={currentPath === "/" ? "page" : undefined}>
          <Home className="sb-ic" size={18} aria-hidden="true" />Dashboard
        </Link>

        <div className="sb-sec">Money</div>
        {sidebarMoneyPages.transactions !== false && (
          <Link className={`sb-item${currentPath === "/transactions" ? " on" : ""}`} href="/transactions" onClick={handleNavClick} aria-current={currentPath === "/transactions" ? "page" : undefined}>
            <ReceiptText className="sb-ic" size={18} aria-hidden="true" />Transactions
          </Link>
        )}
        {showCreditCards && (
          <Link className={`sb-item${currentPath === "/credit-cards" ? " on" : ""}`} href="/credit-cards" onClick={handleNavClick} aria-current={currentPath === "/credit-cards" ? "page" : undefined}>
            <CreditCard className="sb-ic" size={18} aria-hidden="true" />Credit Cards
          </Link>
        )}
        {showCreditTransactions && (
          <Link className={`sb-item${currentPath === "/credit-transactions" ? " on" : ""}`} href="/credit-transactions" onClick={handleNavClick} aria-current={currentPath === "/credit-transactions" ? "page" : undefined}>
            <ListChecks className="sb-ic" size={18} aria-hidden="true" />Card Transactions
          </Link>
        )}
        {sidebarMoneyPages.receivables !== false && (
          <Link className={`sb-item${currentPath === "/receivables" ? " on" : ""}`} href="/receivables" onClick={handleNavClick}>
            <Undo2 className="sb-ic" size={18} aria-hidden="true" />Receivables
            {resolvedReceivablesCount ? <span className="sb-badge">{resolvedReceivablesCount}</span> : null}
          </Link>
        )}
        {sidebarMoneyPages.rewards !== false && (
          <Link className={`sb-item${currentPath === "/rewards" ? " on" : ""}`} href="/rewards" onClick={handleNavClick}>
            <Gift className="sb-ic" size={18} aria-hidden="true" />Rewards
          </Link>
        )}
        {sidebarMoneyPages.investments !== false && (
          <Link className={`sb-item${currentPath === "/investments" ? " on" : ""}`} href="/investments" onClick={handleNavClick}>
            <ChartNoAxesCombined className="sb-ic" size={18} aria-hidden="true" />Investments
          </Link>
        )}
        <Link className={`sb-item${currentPath === "/budgets/plan" ? " on" : ""}`} href="/budgets/plan" onClick={handleNavClick}>
          <ChartPie className="sb-ic" size={18} aria-hidden="true" />Budget Plan
        </Link>

        <div className="sb-sec">Workspace</div>
        <Link className={`sb-item${currentPath === "/collaborators" ? " on" : ""}`} href="/collaborators" onClick={handleNavClick}>
          <Users className="sb-ic" size={18} aria-hidden="true" />Workspaces
        </Link>
        <Link className={`sb-item${currentPath === "/settings" ? " on" : ""}`} href="/settings" onClick={handleNavClick}>
          <Settings className="sb-ic" size={18} aria-hidden="true" />Settings
        </Link>
        {resolvedContext?.isAdmin ? (
          <Link className={`sb-item${currentPath === "/admin" ? " on" : ""}`} href="/admin" onClick={handleNavClick}>
            <ShieldCheck className="sb-ic" size={18} aria-hidden="true" />Admin
          </Link>
        ) : null}

        {/* Mobile-only logout button */}
        <button className="sb-item sb-logout-mobile" onClick={() => void purgePrivateServiceWorkerCaches().finally(() => signOut({ callbackUrl: "/" }))}>
          <LogOut className="sb-ic" size={18} aria-hidden="true" />Log Out
        </button>
      </div>

      <div className="sb-bot">
        <div className="sb-user-wrap" ref={profileMenuRef}>
          <button className="sb-user" onClick={() => setProfileMenuOpen((open) => !open)}>
            {userImage ? (
              <Image src={userImage} alt={avatarAlt} width={36} height={36} className="avatar avatar-md avatar-image" />
            ) : (
              <div className="avatar avatar-md avatar-green">{getInitials(userName)}</div>
            )}
            <div className="sb-user-meta">
              <span className="sb-user-name">{displayName}</span>
              <span className="sb-user-sub">
                {resolvedContext?.isShared ? "👥" : "🔒"}{" "}
                {resolvedContext?.workspaceName || "Workspace"}
              </span>
            </div>
            <span className={`sb-user-chevron${profileMenuOpen ? " open" : ""}`}>▾</span>
          </button>
          {profileMenuOpen && (
            <div className="sb-user-menu">
              <button
                className="sb-user-menu-item"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setProfileModalOpen(true);
                  if (window.matchMedia("(max-width: 1280px)").matches) {
                    setIsOpen(false);
                    window.sessionStorage.setItem("nest:ui:sidebarOpen", "0");
                  }
                }}
              >
                View Profile
              </button>
              <button
                className="sb-user-menu-item sb-user-menu-theme"
                onClick={() => {
                  setProfileMenuOpen(false);
                  toggleTheme();
                }}
              >
                {theme === "light" ? <><Moon size={16} aria-hidden="true" /> Dark mode</> : <><Sun size={16} aria-hidden="true" /> Light mode</>}
              </button>
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
                    <button
                      key={ws.id}
                      className={`sb-user-menu-item sb-user-menu-workspace${isCurrent ? " active" : ""}${isSwitching ? " switching" : ""}`}
                      onClick={() => switchWorkspace(ws.id)}
                      disabled={isCurrent || isSwitching}
                    >
                      <span className="sb-workspace-icon">
                        {isSwitching ? <span className="sb-workspace-spinner" /> : isCurrent ? "✓" : "○"}
                      </span>
                      <span className="sb-workspace-name">{ws.name}</span>
                    </button>
                  );
                })
              )}
              <div className="sb-user-menu-divider" />
              <button className="sb-user-menu-item" onClick={() => void purgePrivateServiceWorkerCaches().finally(() => signOut({ callbackUrl: "/" }))}>
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
          </>
        )}

      </aside>

      {profileModalOpen && typeof document !== "undefined" && createPortal(
        <div className="profile-modal-overlay account-profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setProfileModalOpen(false))}>
          <div className="profile-modal account-profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Profile</h3>
              <ModalCloseButton onClick={() => setProfileModalOpen(false)} label="Close Profile" />
            </div>
            <div className="modal-form-shell">
              <div className="profile-modal-body">
              {userImage ? (
                <Image src={userImage} alt={avatarAlt} width={44} height={44} className="avatar avatar-lg avatar-image" />
              ) : (
                <div className="avatar avatar-lg avatar-green">{getInitials(displayName)}</div>
              )}
              <div className="profile-field">
                <span>Name</span>
                <input
                  className="input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="profile-field">
                <span>Email</span>
                <strong title={userEmail || "No email"}>{userEmail || "No email"}</strong>
              </div>
              <div className="profile-field">
                <span>Account</span>
                <strong>Personal Workspace</strong>
              </div>
              {profileError && (
                <div className="profile-error">{profileError}</div>
              )}
              </div>
              <div className="profile-actions">
                <button className="btn btn-ghost btn-xs" onClick={() => setProfileModalOpen(false)} disabled={savingProfile}>
                  Cancel
                </button>
                <button className="btn btn-primary btn-xs" onClick={saveDisplayName} disabled={savingProfile}>
                  {savingProfile ? "Saving..." : "Update"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

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
