"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { purgePrivateServiceWorkerCaches } from "@/lib/service-worker-cache";

type Workspace = {
  id: string;
  name: string;
  baseCurrency: string;
  role: string;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function MobileAccountPanel({
  userName,
  userEmail,
  userImage,
  workspaceId,
  workspaceName,
  onDisplayNameUpdated,
  onClose,
}: {
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  onDisplayNameUpdated?: (name: string) => void;
  onClose: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(userName);
  const [editingName, setEditingName] = useState(userName);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const avatarAlt = displayName || userEmail || "User";

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const response = await fetch("/api/workspaces");
      if (!response.ok) throw new Error("Failed to load workspaces");
      return response.json() as Promise<Workspace[]>;
    },
  });

  useEffect(() => {
    setDisplayName(userName);
    setEditingName(userName);
  }, [userName]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setProfileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [profileOpen]);

  const saveDisplayName = async () => {
    const nextName = editingName.trim();
    if (!nextName) {
      setProfileError("Display name is required.");
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || payload?.error || "Failed to update profile");
      }
      setDisplayName(nextName);
      onDisplayNameUpdated?.(nextName);
      setProfileOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const switchWorkspace = async (nextWorkspaceId: string) => {
    if (nextWorkspaceId === workspaceId) return;
    const nextWorkspace = workspaces.data?.find((workspace) => workspace.id === nextWorkspaceId);
    setSwitchingWorkspaceId(nextWorkspaceId);
    setIsTransitioning(true);
    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: nextWorkspaceId }),
      });
      if (!response.ok) throw new Error("Failed to switch workspace");

      queryClient.setQueryData(["app-context"], (existing: {
        workspaceId?: string | null;
        workspaceName?: string | null;
      } | undefined) => existing ? {
        ...existing,
        workspaceId: nextWorkspaceId,
        workspaceName: nextWorkspace?.name ?? existing.workspaceName,
      } : existing);

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

      onClose();
      router.push("/");
    } catch {
      setSwitchingWorkspaceId(null);
      setIsTransitioning(false);
    }
  };

  return (
    <>
      <div className="mobile-account-panel">
        {profileOpen ? (
          <form
            className="mobile-account-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDisplayName();
            }}
          >
            <button className="mobile-account-profile-back" type="button" onClick={() => setProfileOpen(false)}>
              <ArrowLeft size={17} aria-hidden="true" /> Back to account
            </button>
            <div className="mobile-account-profile-heading">
              {userImage ? (
                <Image src={userImage} alt={avatarAlt} width={44} height={44} className="avatar avatar-lg avatar-image" />
              ) : (
                <div className="avatar avatar-lg avatar-green">{initials(displayName)}</div>
              )}
              <div><strong>Edit profile</strong><span>Update your Nest account details.</span></div>
            </div>
            <label className="mobile-account-profile-field">
              <span>Name</span>
              <input className="input" value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={120} autoFocus />
            </label>
            <div className="mobile-account-profile-meta"><span>Email</span><strong>{userEmail || "No email"}</strong></div>
            <div className="mobile-account-profile-meta"><span>Workspace</span><strong>{workspaceName || "Personal workspace"}</strong></div>
            {profileError ? <div className="profile-error">{profileError}</div> : null}
            <div className="mobile-account-profile-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setProfileOpen(false)} disabled={savingProfile}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={savingProfile}>
                {savingProfile ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <>
        <div className="mobile-account-identity">
          {userImage ? (
            <Image src={userImage} alt={avatarAlt} width={44} height={44} className="avatar avatar-lg avatar-image" />
          ) : (
            <div className="avatar avatar-lg avatar-green">{initials(displayName)}</div>
          )}
          <div>
            <strong>{displayName || "Account"}</strong>
            <span>{userEmail || workspaceName || "Nest account"}</span>
          </div>
        </div>

        <button className="mobile-account-action" type="button" onClick={() => setProfileOpen(true)}>
          <UserRound size={19} aria-hidden="true" />
          <span><strong>View profile</strong><small>Update your name and account details</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>

        <button className="mobile-account-action" type="button" onClick={toggleTheme}>
          {theme === "light" ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
          <span>
            <strong>{theme === "light" ? "Dark mode" : "Light mode"}</strong>
            <small>Change the app appearance</small>
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>

        <div className="mobile-account-section-label">Switch workspace</div>
        <div className="mobile-account-workspaces">
          {workspaces.isLoading ? <div className="mobile-account-loading"><span className="sb-workspace-spinner" /> Loading workspaces...</div> : null}
          {workspaces.isError ? <div className="mobile-account-loading">Workspaces could not be loaded.</div> : null}
          {workspaces.data?.map((workspace) => {
            const isCurrent = workspace.id === workspaceId;
            const isSwitching = switchingWorkspaceId === workspace.id;
            return (
              <button
                className={`mobile-account-workspace${isCurrent ? " is-current" : ""}`}
                type="button"
                key={workspace.id}
                onClick={() => switchWorkspace(workspace.id)}
                disabled={isCurrent || isSwitching}
              >
                <span className="mobile-account-workspace-mark">
                  {isSwitching ? <span className="sb-workspace-spinner" /> : isCurrent ? <Check size={16} aria-hidden="true" /> : null}
                </span>
                <span><strong>{workspace.name}</strong><small>{workspace.baseCurrency}</small></span>
              </button>
            );
          })}
        </div>

        <button className="mobile-account-action mobile-account-logout" type="button" onClick={() => void purgePrivateServiceWorkerCaches().finally(() => signOut({ callbackUrl: "/signin" }))}>
          <LogOut size={19} aria-hidden="true" />
          <span><strong>Log out</strong><small>Sign out of Nest on this device</small></span>
        </button>
          </>
        )}
      </div>

      {isTransitioning ? (
        <div className="workspace-transition-overlay">
          <div className="workspace-transition-content">
            <div className="workspace-transition-spinner" />
            <span className="workspace-transition-text">Switching workspace...</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
