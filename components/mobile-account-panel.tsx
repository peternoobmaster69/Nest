"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";

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
  onClose,
}: {
  userName: string;
  userEmail?: string;
  userImage?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  onClose: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const avatarAlt = userName || userEmail || "User";

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const response = await fetch("/api/workspaces");
      if (!response.ok) throw new Error("Failed to load workspaces");
      return response.json() as Promise<Workspace[]>;
    },
  });

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
        <div className="mobile-account-identity">
          {userImage ? (
            <Image src={userImage} alt={avatarAlt} width={44} height={44} className="avatar avatar-lg avatar-image" />
          ) : (
            <div className="avatar avatar-lg avatar-green">{initials(userName)}</div>
          )}
          <div>
            <strong>{userName || "Account"}</strong>
            <span>{userEmail || workspaceName || "Nest account"}</span>
          </div>
        </div>

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
