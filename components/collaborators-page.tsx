"use client";

import { workspaceFetch } from "@/lib/workspace-client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingDots } from "@/components/ui-skeleton";
import { CollaboratorsAuditSkeleton, CollaboratorsInvitesSkeleton, CollaboratorsRowsSkeleton } from "@/components/skeletons/CollaboratorsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { useRouter } from "next/navigation";
import { buildWorkspacePath } from "@/lib/workspace-entry";

// Default visibility for Money section pages
const DEFAULT_MONEY_PAGES = {
  creditCards: true,
  creditTransactions: true,
  receivables: true,
  transactions: true,
  rewards: true,
  investments: true,
};

const MONEY_PAGE_CONFIG = [
  { key: "transactions", label: "Transactions", icon: "📑" },
  { key: "creditCards", label: "Credit Cards", icon: "💳" },
  { key: "creditTransactions", label: "Card Transactions", icon: "🧾" },
  { key: "receivables", label: "Receivables", icon: "↩" },
  { key: "rewards", label: "Rewards", icon: "◎" },
  { key: "investments", label: "Investments", icon: "📈" },
];

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  isShared?: boolean;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  workspaces?: Array<{ id: string; name: string; role?: "OWNER" | "EDITOR" | "VIEWER" }>;
  sidebarMoneyPages?: Record<string, boolean>;
};

type CollaboratorData = {
  role: "OWNER" | "EDITOR" | "VIEWER";
  workspace: { id: string; name: string; isShared: boolean } | null;
  members: Array<{
    id: string;
    role: string;
    user: { id: string; name: string | null; email: string | null };
  }>;
  invites: Array<{
    id: string;
    invitedEmail: string;
    status: string;
    role: "EDITOR" | "VIEWER";
    createdAt: string;
    expiresAt: string | null;
    invitedBy: { id: string; name: string | null; email: string | null } | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    details: string;
    createdAt: string;
    actorUser: { id: string; name: string | null; email: string | null } | null;
  }>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await workspaceFetch(url, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      message = payload?.message || payload?.error || message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

export function CollaboratorsPage({ workspaceSettings }: { workspaceSettings?: ReactNode }) {
  const routeWorkspaceId = useWorkspaceId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<"PRIVATE" | "SHARED">("PRIVATE");
  const [sidebarMoneyPages, setSidebarMoneyPages] = useState<Record<string, boolean>>(DEFAULT_MONEY_PAGES);
  const [switchingWorkspaceName, setSwitchingWorkspaceName] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const context = useQuery({
    queryKey: ["app-context", routeWorkspaceId],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId ?? null;

  const collab = useQuery({
    queryKey: ["collaborators", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => fetchJson<CollaboratorData>(`/api/collaborators?workspaceId=${workspaceId}`),
  });
  const { isLoading: isCollabLoading, isError: isCollabError, refetch: refetchCollab } = collab;

  const workspaceMeta = collab.data?.workspace
    ? collab.data.workspace
    : workspaceId
      ? {
          id: workspaceId,
          name: context.data?.workspaceName || "",
          isShared: Boolean(context.data?.isShared),
        }
      : null;
  const isShared = workspaceMeta?.isShared ?? false;
  const isOwner = collab.data?.role === "OWNER" || context.data?.role === "OWNER";

  useEffect(() => {
    if (!workspaceMeta) return;
    setWorkspaceNameInput(workspaceMeta.name);
    setWorkspaceMode(workspaceMeta.isShared ? "SHARED" : "PRIVATE");
    // Initialize sidebarMoneyPages from context or defaults
    setSidebarMoneyPages(context.data?.sidebarMoneyPages ?? DEFAULT_MONEY_PAGES);
  }, [workspaceMeta?.id, workspaceMeta?.name, workspaceMeta?.isShared, context.data?.sidebarMoneyPages]);

  const createWorkspace = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string; name: string }>("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWorkspaceName }),
      }),
    onSuccess: async (workspace) => {
      setMessage(`Workspace "${workspace.name}" created.`);
      setNewWorkspaceName("");
      await queryClient.invalidateQueries({ queryKey: ["app-context"] });
      await queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to create workspace."),
  });

  const switchWorkspace = useMutation({
    mutationFn: (targetWorkspaceId: string) =>
      fetchJson("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: targetWorkspaceId }),
      }),
    onMutate: (targetWorkspaceId) => {
      const targetWorkspace = context.data?.workspaces?.find((workspace) => workspace.id === targetWorkspaceId);
      setSwitchingWorkspaceName(targetWorkspace?.name ?? "workspace");
      setMessage("");
    },
    onSuccess: async (_, targetWorkspaceId) => {
      await queryClient.invalidateQueries({ queryKey: ["app-context"] });
      await queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["budgets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["receivables"] });
      await queryClient.invalidateQueries({ queryKey: ["receivables-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["investments"] });
      await queryClient.invalidateQueries({ queryKey: ["credit-cards"] });
      await queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setMessage("Workspace switched.");
      router.push(buildWorkspacePath(targetWorkspaceId, "/settings?tab=workspaces"));
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to switch workspace."),
    onSettled: () => setSwitchingWorkspaceName(null),
  });
  const isWorkspaceChanging = switchWorkspace.isPending || Boolean(switchingWorkspaceName);

  const updateWorkspace = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string; name: string; isShared: boolean; sidebarMoneyPages?: string }>(`/api/workspaces/${workspaceMeta?.id ?? workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(workspaceNameInput.trim() ? { name: workspaceNameInput.trim() } : {}),
          isShared: workspaceMode === "SHARED",
          sidebarMoneyPages,
        }),
      }),
    onSuccess: async (updatedWorkspace) => {
      // Parse sidebarMoneyPages from response
      let parsedSidebarMoneyPages: Record<string, boolean> = sidebarMoneyPages;
      if (updatedWorkspace.sidebarMoneyPages) {
        try {
          parsedSidebarMoneyPages = JSON.parse(updatedWorkspace.sidebarMoneyPages);
        } catch {
          // Keep current state if parsing fails
        }
      }

      queryClient.setQueryData<AppContext>(["app-context", routeWorkspaceId], (existing) => {
        if (!existing) return existing;
        return {
          ...existing,
          workspaceName: existing.workspaceId === updatedWorkspace.id ? updatedWorkspace.name : existing.workspaceName,
          isShared: existing.workspaceId === updatedWorkspace.id ? updatedWorkspace.isShared : existing.isShared,
          sidebarMoneyPages: parsedSidebarMoneyPages,
          workspaces: (existing.workspaces ?? []).map((workspace) =>
            workspace.id === updatedWorkspace.id ? { ...workspace, name: updatedWorkspace.name } : workspace,
          ),
        };
      });
      queryClient.setQueryData<CollaboratorData>(["collaborators", updatedWorkspace.id], (existing) => {
        if (!existing) return existing;
        return {
          ...existing,
          workspace: existing.workspace
            ? { ...existing.workspace, name: updatedWorkspace.name, isShared: updatedWorkspace.isShared }
            : { id: updatedWorkspace.id, name: updatedWorkspace.name, isShared: updatedWorkspace.isShared },
        };
      });
      setMessage("Workspace info updated.");
      await queryClient.invalidateQueries({ queryKey: ["app-context"] });
      await queryClient.invalidateQueries({ queryKey: ["collaborators", updatedWorkspace.id] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to update workspace."),
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      fetchJson<{ inviteUrl: string; emailSent: boolean }>("/api/collaborators/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceMeta?.id ?? workspaceId, email: inviteEmail, role: inviteRole }),
      }),
    onSuccess: async (data) => {
      setMessage(data.emailSent ? "Invite sent." : `Invite created. Copy this one-time link: ${data.inviteUrl}`);
      setInviteEmail("");
      await queryClient.invalidateQueries({ queryKey: ["collaborators", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["app-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to invite collaborator."),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      fetchJson(`/api/collaborators/${memberId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      setMessage("Collaborator removed.");
      await queryClient.invalidateQueries({ queryKey: ["collaborators", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["app-context"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to remove collaborator."),
  });

  const updateMemberRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: "EDITOR" | "VIEWER" }) =>
      fetchJson(`/api/collaborators/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: async () => {
      setMessage("Collaborator role updated.");
      await queryClient.invalidateQueries({ queryKey: ["collaborators", workspaceId] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to update collaborator."),
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => fetchJson(`/api/collaborators/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setMessage("Invitation revoked.");
      await queryClient.invalidateQueries({ queryKey: ["collaborators", workspaceId] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to revoke invitation."),
  });

  const onCreateWorkspace = (event: FormEvent) => {
    event.preventDefault();
    if (!newWorkspaceName.trim()) return;
    createWorkspace.mutate();
  };

  const onUpdateWorkspace = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceMeta?.id) return;
    updateWorkspace.mutate();
  };

  const onInvite = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceMeta?.id || !inviteEmail.trim()) return;
    inviteMutation.mutate();
  };

  const confirmRemoveMember = async (memberId: string) => {
    if (!(await confirmDestructiveAction("Remove this collaborator from the workspace?"))) return;
    removeMember.mutate(memberId);
  };

  return (
    <div className="workspace-settings-page">
      {isWorkspaceChanging ? (
        <section
          className="card workspace-settings-status"
          role="status"
          aria-live="polite"
        >
          <div className="page-loading-spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Switching to <strong>{switchingWorkspaceName || "workspace"}</strong>
            <LoadingDots />
          </span>
        </section>
      ) : null}

      {message ? (
        <div className="workspace-settings-message" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}

      <section className="card workspace-picker-card">
        <div className={`workspace-settings-card-content${isWorkspaceChanging ? " is-changing" : ""}`}>
          <div className="settings-item-copy">
            <div className="settings-section-title">Choose workspace</div>
            <div className="settings-section-copy">All settings below apply to the selected workspace.</div>
          </div>
          <div className="workspace-picker-options" role="group" aria-label="Available workspaces">
            {(context.data?.workspaces ?? []).map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={`btn btn-ghost btn-xs workspace-picker-option${workspace.id === workspaceId ? " is-current" : ""}`}
                aria-pressed={workspace.id === workspaceId}
                onClick={() => switchWorkspace.mutate(workspace.id)}
                disabled={isWorkspaceChanging}
              >
                {workspace.name}
              </button>
            ))}
          </div>

          <form className="workspace-create-form" onSubmit={onCreateWorkspace}>
            <input
              className="input"
              aria-label="New workspace name"
              placeholder="New workspace name"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
            />
            <button className="btn btn-primary btn-xs" type="submit" disabled={createWorkspace.isPending || isWorkspaceChanging}>
              {createWorkspace.isPending ? "Creating..." : "Add workspace"}
            </button>
          </form>
        </div>
      </section>

      <section className="card workspace-details-card">
        <div className={`workspace-settings-card-content${isWorkspaceChanging ? " is-changing" : ""}`}>
          <div className="settings-item-copy">
            <div className="settings-section-title">Workspace details</div>
            <div className="settings-section-copy">
              {isOwner
                ? "Update its name, access mode, and visible Money navigation."
                : "Review this workspace and its members."}
            </div>
          </div>
          {isOwner ? <>
            {updateWorkspace.isPending ? (
              <div className="workspace-save-progress" aria-label="Saving workspace info">
                <div className="workspace-save-progress-bar" />
              </div>
            ) : null}
            <form className="workspace-details-form" onSubmit={onUpdateWorkspace}>
            <label className="workspace-settings-field">
              <span>Name</span>
              <input
                className="input"
                placeholder="Workspace name"
                value={workspaceNameInput}
                onChange={(e) => setWorkspaceNameInput(e.target.value)}
              />
            </label>
            <label className="workspace-settings-field">
              <span>Access</span>
              <select
                className="input"
                value={workspaceMode}
                onChange={(e) => setWorkspaceMode(e.target.value === "SHARED" ? "SHARED" : "PRIVATE")}
              >
                <option value="PRIVATE">Private workspace</option>
                <option value="SHARED">Shared workspace</option>
              </select>
            </label>
            <button
              className="btn btn-primary btn-xs"
              type="submit"
              disabled={!workspaceMeta?.id || updateWorkspace.isPending || isWorkspaceChanging}
            >
              {updateWorkspace.isPending ? "Saving..." : "Save details"}
            </button>
            </form>

            <div className="workspace-money-pages">
            <div className="workspace-money-pages-title">
              Sidebar Navigation — Money Pages
            </div>
            <div className="workspace-money-page-grid">
              {MONEY_PAGE_CONFIG.map((page) => (
                <label
                  key={page.key}
                  className="workspace-money-page-option"
                >
                  <input
                    type="checkbox"
                    checked={sidebarMoneyPages[page.key] ?? true}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSidebarMoneyPages((prev) => {
                        const next = {
                          ...prev,
                          [page.key]: checked,
                        };
                        if (page.key === "creditCards" && !checked) {
                          next.creditTransactions = false;
                        }
                        return next;
                      });
                    }}
                    disabled={!workspaceMeta?.id || updateWorkspace.isPending || isWorkspaceChanging}
                  />
                  <span className="workspace-money-page-icon" aria-hidden="true">{page.icon}</span>
                  <span>{page.label}</span>
                </label>
              ))}
            </div>
            <div className="workspace-money-pages-help">
              Changes save when you save Workspace details.
            </div>
            </div>
          </> : null}

          <div className="workspace-members-section">
            <div className="settings-section-title">Members</div>
            <div className="simple-list">
              {isCollabLoading && (
                <CollaboratorsRowsSkeleton />
              )}

              {isCollabError && (
                <EmptyState
                  icon="⚠️"
                  title="Failed to load collaborators"
                  action={<button className="btn btn-primary" onClick={() => refetchCollab()}>Retry</button>}
                />
              )}

              {!isCollabLoading && !isCollabError && (collab.data?.members ?? []).map((member) => (
                <div key={member.id} className="crud-row">
                  <span>{member.user.name || member.user.email || member.user.id}</span>
                  <div style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
                    {isOwner && member.role !== "OWNER" ? (
                      <select
                        className="input"
                        value={member.role === "MEMBER" ? "EDITOR" : member.role}
                        onChange={(event) => updateMemberRole.mutate({ memberId: member.id, role: event.target.value === "VIEWER" ? "VIEWER" : "EDITOR" })}
                        disabled={updateMemberRole.isPending || isWorkspaceChanging}
                      >
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                    ) : <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{member.role}</span>}
                    {isOwner && member.role !== "OWNER" ? (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => confirmRemoveMember(member.id)}
                        disabled={removeMember.isPending || isWorkspaceChanging}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {!isCollabLoading && !isCollabError && !(collab.data?.members?.length) && (
                <EmptyState icon="👥" title="No collaborators yet" description="Invite team members to collaborate on this workspace." />
              )}
            </div>
          </div>
        </div>
      </section>

      {workspaceSettings}

      {isOwner && isShared ? (
        <section className="card">
          <div className={`workspace-settings-card-content${isWorkspaceChanging ? " is-changing" : ""}`}>
            <div className="settings-section-title">Invite people</div>
            <form className="workspace-invite-form" onSubmit={onInvite}>
              <input
                className="input"
                type="email"
                placeholder="name@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
              <select className="input" value={inviteRole} onChange={(event) => setInviteRole(event.target.value === "VIEWER" ? "VIEWER" : "EDITOR")}>
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button
                className="btn btn-primary btn-xs"
                type="submit"
                disabled={!workspaceMeta?.id || inviteMutation.isPending || isWorkspaceChanging}
              >
                {inviteMutation.isPending ? "Sending..." : "Invite"}
              </button>
            </form>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Invitations require explicit acceptance, expire after seven days, and can be revoked below.
            </div>
          </div>
        </section>
      ) : null}

      {isOwner && isShared ? (
        <section className="card">
          <div className="settings-section-title">Pending invites</div>
          <div className="simple-list">
            {isCollabLoading && <CollaboratorsInvitesSkeleton />}
            {!isCollabLoading && !isCollabError && (collab.data?.invites ?? []).map((invite) => (
              <div key={invite.id} className="crud-row">
                <span>{invite.invitedEmail} · {invite.role}</span>
                <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>Expires {invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "soon"}</span>
                  <button className="btn btn-ghost btn-xs" onClick={() => revokeInvite.mutate(invite.id)} disabled={revokeInvite.isPending}>Revoke</button>
                </div>
              </div>
            ))}
            {!isCollabLoading && !isCollabError && !(collab.data?.invites?.length) && (
              <EmptyState
                icon="📧"
                title="No pending invites"
                description="Invitations you send will appear here until they are accepted."
              />
            )}
          </div>
        </section>
      ) : null}

      {isOwner && isShared ? (
        <section className="card">
          <div className="settings-section-title">Audit log</div>
          <div className="audit-timeline">
            {isCollabLoading && (
              <CollaboratorsAuditSkeleton />
            )}
            {!isCollabLoading && !isCollabError && (collab.data?.auditLogs ?? []).map((log) => (
              <article key={log.id} className="audit-item">
                <div className="audit-dot" aria-hidden="true" />
                <div className="audit-content">
                  <p className="audit-details">{log.details}</p>
                  <p className="audit-meta">
                    {log.actorUser?.name || log.actorUser?.email || "System"} · {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              </article>
            ))}
            {!isCollabLoading && !isCollabError && !(collab.data?.auditLogs?.length) && (
              <EmptyState icon="📋" title="No audit logs yet" description="Activity in this workspace will be recorded here." />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
