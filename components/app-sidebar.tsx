"use client";

import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "./theme-provider";
import { SidebarSkeleton } from "./ui-skeleton";

type Workspace = {
  id: string;
  name: string;
  baseCurrency: string;
  role: string;
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
  onDisplayNameUpdated?: (name: string) => void;
  currentPath: string;
  badgeCounts?: {
    budgets?: number;
    receivables?: number;
  };
  sidebarOpen?: boolean;
  onSidebarChange?: (open: boolean) => void;
  contextData?: {
    isShared?: boolean;
    isCollaborative?: boolean;
    workspaceName?: string | null;
    memberCount?: number;
    pendingInviteCount?: number;
    sidebarMoneyPages?: Record<string, boolean>;
  };
  contextLoading?: boolean;
}) {
  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: async () => {
      const res = await fetch("/api/context");
      if (!res.ok) throw new Error("Failed to load context");
      return res.json() as Promise<{
        isShared?: boolean;
        isCollaborative?: boolean;
        workspaceName?: string | null;
        memberCount?: number;
        pendingInviteCount?: number;
        sidebarMoneyPages?: Record<string, boolean>;
      }>;
    },
    enabled: !contextData,
  });

  const resolvedContext = contextData ?? context.data;
  const isContextLoading = contextLoading || (!contextData && context.isLoading);

  // Get sidebar visibility settings with defaults
  const sidebarMoneyPages = resolvedContext?.sidebarMoneyPages ?? {
    creditCards: true,
    creditTransactions: true,
    receivables: true,
    transactions: true,
    rewards: true,
    investments: true,
  };

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
    const onClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
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
    if (window.matchMedia("(max-width: 1024px)").matches) {
      setIsOpen(false);
      window.sessionStorage.setItem("nest:ui:sidebarOpen", "0");
    }
  };

  const switchWorkspace = async (workspaceId: string) => {
    if (workspaceId === resolvedContext?.workspaceName) return;
    setSwitchingWorkspaceId(workspaceId);
    setIsTransitioning(true);
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error("Failed to switch workspace");
      // Invalidate all queries to refresh data
      await queryClient.invalidateQueries();
      // Close menu and navigate to dashboard
      setProfileMenuOpen(false);
      router.push("/");
      router.refresh();
      // Hide transition overlay after navigation completes
      setTimeout(() => {
        setIsTransitioning(false);
        setSwitchingWorkspaceId(null);
      }, 800);
    } catch {
      setSwitchingWorkspaceId(null);
      setIsTransitioning(false);
    }
  };

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}
      <aside ref={sidebarRef} className={`sidebar${isOpen ? " open" : ""}`}>
        <Link href="/" className="sb-logo" onClick={handleNavClick}>
          <Image src="/icon.svg" alt="Nest" width={30} height={30} className="brand-logo-sm" />
          <span>Nest</span>
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
        </Link>

        {isContextLoading ? (
          <SidebarSkeleton />
        ) : (
          <>
      <div className="sb-scroll">
        <div className="sb-sec">Overview</div>
        <Link className={`sb-item${currentPath === "/" ? " on" : ""}`} href="/" onClick={handleNavClick}>
          <span className="sb-ic">⌂</span>Dashboard
        </Link>

        <div className="sb-sec">Money</div>
        {sidebarMoneyPages.creditCards !== false && (
          <Link className={`sb-item${currentPath === "/credit-cards" ? " on" : ""}`} href="/credit-cards" onClick={handleNavClick}>
            <span className="sb-ic">💳</span>Credit Cards
          </Link>
        )}
        {sidebarMoneyPages.creditTransactions !== false && (
          <Link className={`sb-item${currentPath === "/credit-transactions" ? " on" : ""}`} href="/credit-transactions" onClick={handleNavClick}>
            <span className="sb-ic">🧾</span>Card Transactions
          </Link>
        )}
        {sidebarMoneyPages.receivables !== false && (
          <Link className={`sb-item${currentPath === "/receivables" ? " on" : ""}`} href="/receivables" onClick={handleNavClick}>
            <span className="sb-ic">↩</span>Receivables
            {badgeCounts?.receivables ? <span className="sb-badge">{badgeCounts.receivables}</span> : null}
          </Link>
        )}
        {sidebarMoneyPages.transactions !== false && (
          <Link className={`sb-item${currentPath === "/transactions" ? " on" : ""}`} href="/transactions" onClick={handleNavClick}>
            <span className="sb-ic">📑</span>Transactions
          </Link>
        )}
        {sidebarMoneyPages.rewards !== false && (
          <Link className={`sb-item${currentPath === "/rewards" ? " on" : ""}`} href="/rewards" onClick={handleNavClick}>
            <span className="sb-ic">◎</span>Rewards
          </Link>
        )}
        {sidebarMoneyPages.investments !== false && (
          <Link className={`sb-item${currentPath === "/investments" ? " on" : ""}`} href="/investments" onClick={handleNavClick}>
            <span className="sb-ic">📈</span>Investments
          </Link>
        )}
        <Link className={`sb-item${currentPath === "/budgets/plan" ? " on" : ""}`} href="/budgets/plan" onClick={handleNavClick}>
          <span className="sb-ic">📊</span>Budget Plan
        </Link>

        <div className="sb-sec">Workspace</div>
        <Link className={`sb-item${currentPath === "/collaborators" ? " on" : ""}`} href="/collaborators" onClick={handleNavClick}>
          <span className="sb-ic">👥</span>Workspaces
        </Link>
        <Link className={`sb-item${currentPath === "/settings" ? " on" : ""}`} href="/settings" onClick={handleNavClick}>
          <span className="sb-ic">⚙</span>Settings
        </Link>

        {/* Mobile-only logout button */}
        <button className="sb-item sb-logout-mobile" onClick={() => signOut({ callbackUrl: "/signin" })}>
          <span className="sb-ic">⎋</span>Log Out
        </button>
      </div>

      <div className="sb-bot">
        <div className="sb-user-wrap" ref={profileMenuRef}>
          <button className="sb-user" onClick={() => setProfileMenuOpen((open) => !open)}>
            <div className="avatar avatar-md avatar-green">{getInitials(userName)}</div>
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
                }}
              >
                View Profile
              </button>
              <button
                className="sb-user-menu-item"
                onClick={() => {
                  setProfileMenuOpen(false);
                  toggleTheme();
                }}
              >
                {theme === "light" ? "🌙 Dark Mode" : "☀️ Light Mode"}
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
                  const isCurrent = ws.name === resolvedContext?.workspaceName;
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
              <button className="sb-user-menu-item" onClick={() => signOut({ callbackUrl: "/signin" })}>
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
          </>
        )}

      {profileModalOpen && (
        <div className="profile-modal-overlay" onClick={() => setProfileModalOpen(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-head">
              <h3>Profile</h3>
              <button className="profile-modal-close" onClick={() => setProfileModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="profile-modal-body">
              <div className="avatar avatar-lg avatar-green">{getInitials(displayName)}</div>
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
        </div>
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
