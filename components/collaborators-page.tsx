"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { EmptyState, LoadingDots, SkeletonText } from "@/components/ui-skeleton";

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  isShared?: boolean;
  workspaces?: Array<{ id: string; name: string }>;
};

type CollaboratorData = {
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
    createdAt: string;
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
  const res = await fetch(url, init);
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

export function CollaboratorsPage() {
  const queryClient = useQueryClient();
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [workspaceNameInput, setWorkspaceNameInput] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<"PRIVATE" | "SHARED">("PRIVATE");
  const [switchingWorkspaceName, setSwitchingWorkspaceName] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const context = useQuery({
    queryKey: ["app-context"],
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

  useEffect(() => {
    if (!workspaceMeta) return;
    setWorkspaceNameInput(workspaceMeta.name);
    setWorkspaceMode(workspaceMeta.isShared ? "SHARED" : "PRIVATE");
  }, [workspaceMeta?.id, workspaceMeta?.name, workspaceMeta?.isShared]);

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-context"] });
      await queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["budgets"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["receivables"] });
      setMessage("Workspace switched.");
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to switch workspace."),
    onSettled: () => setSwitchingWorkspaceName(null),
  });
  const isWorkspaceChanging = switchWorkspace.isPending || Boolean(switchingWorkspaceName);

  const updateWorkspace = useMutation({
    mutationFn: () =>
      fetchJson<{ id: string; name: string; isShared: boolean }>(`/api/workspaces/${workspaceMeta?.id ?? workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(workspaceNameInput.trim() ? { name: workspaceNameInput.trim() } : {}),
          isShared: workspaceMode === "SHARED",
        }),
      }),
    onSuccess: async (updatedWorkspace) => {
      queryClient.setQueryData<AppContext>(["app-context"], (existing) => {
        if (!existing) return existing;
        return {
          ...existing,
          workspaceName: existing.workspaceId === updatedWorkspace.id ? updatedWorkspace.name : existing.workspaceName,
          isShared: existing.workspaceId === updatedWorkspace.id ? updatedWorkspace.isShared : existing.isShared,
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
      fetchJson("/api/collaborators/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceMeta?.id ?? workspaceId, email: inviteEmail }),
      }),
    onSuccess: async () => {
      setMessage("Invite sent.");
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

  return (
    <div style={{ display: "grid", gap: "12px", position: "relative" }}>
      {isWorkspaceChanging ? (
        <section
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--surface-elevated)",
            borderColor: "var(--brand-300)",
          }}
        >
          <div className="page-loading-spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Switching to <strong>{switchingWorkspaceName || "workspace"}</strong>
            <LoadingDots />
          </span>
        </section>
      ) : null}
      <section className="card">
        <div style={{ display: "grid", gap: "8px", opacity: isWorkspaceChanging ? 0.65 : 1, transition: "opacity 180ms ease" }}>
          <div style={{ fontSize: "13px", fontWeight: 700 }}>Workspace</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {(context.data?.workspaces ?? []).map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className="btn btn-ghost btn-xs"
                style={{
                  borderColor: workspace.id === workspaceId ? "var(--brand-500)" : undefined,
                  color: workspace.id === workspaceId ? "var(--brand-600)" : undefined,
                }}
                onClick={() => switchWorkspace.mutate(workspace.id)}
                disabled={isWorkspaceChanging}
              >
                {workspace.name}
              </button>
            ))}
          </div>

          <form onSubmit={onCreateWorkspace} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="New workspace name"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              style={{ maxWidth: "280px" }}
            />
            <button className="btn btn-primary btn-xs" type="submit" disabled={createWorkspace.isPending || isWorkspaceChanging}>
              {createWorkspace.isPending ? "Creating..." : "+ Add Workspace"}
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "grid", gap: "8px", opacity: isWorkspaceChanging ? 0.65 : 1, transition: "opacity 180ms ease" }}>
          <div style={{ fontSize: "13px", fontWeight: 700 }}>Workspace Info</div>
          {updateWorkspace.isPending ? (
            <div className="workspace-save-progress" aria-label="Saving workspace info">
              <div className="workspace-save-progress-bar" />
            </div>
          ) : null}
          <form onSubmit={onUpdateWorkspace} style={{ display: "grid", gap: "8px", maxWidth: "380px" }}>
            <input
              className="input"
              placeholder="Workspace name"
              value={workspaceNameInput}
              onChange={(e) => setWorkspaceNameInput(e.target.value)}
            />
            <select
              className="input"
              value={workspaceMode}
              onChange={(e) => setWorkspaceMode(e.target.value === "SHARED" ? "SHARED" : "PRIVATE")}
            >
              <option value="PRIVATE">Private Workspace</option>
              <option value="SHARED">Shared Workspace</option>
            </select>
            <button
              className="btn btn-primary btn-xs"
              type="submit"
              disabled={!workspaceMeta?.id || updateWorkspace.isPending || isWorkspaceChanging}
            >
              {updateWorkspace.isPending ? "Saving..." : "Save Workspace Info"}
            </button>
          </form>
        </div>
      </section>

      {isShared ? (
        <section className="card">
          <div style={{ display: "grid", gap: "8px", opacity: isWorkspaceChanging ? 0.65 : 1, transition: "opacity 180ms ease" }}>
            <div style={{ fontSize: "13px", fontWeight: 700 }}>Invite Collaborator</div>
            <form onSubmit={onInvite} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                className="input"
                type="email"
                placeholder="name@email.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                style={{ maxWidth: "300px" }}
              />
              <button
                className="btn btn-primary btn-xs"
                type="submit"
                disabled={!workspaceMeta?.id || inviteMutation.isPending || isWorkspaceChanging}
              >
                {inviteMutation.isPending ? "Sending..." : "Invite"}
              </button>
            </form>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              Invites are sent by email. Existing Nest users are added immediately; others are added after they sign in with the invited email.
            </div>
          </div>
        </section>
      ) : null}

      <section className="card" style={{ opacity: isWorkspaceChanging ? 0.65 : 1, transition: "opacity 180ms ease" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Collaborators</div>
        <div className="simple-list">
          {isCollabLoading && (
            <>
              <div className="crud-row"><SkeletonText lines={1} /></div>
              <div className="crud-row"><SkeletonText lines={1} /></div>
            </>
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
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{member.role}</span>
                {member.role !== "OWNER" ? (
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => removeMember.mutate(member.id)}
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
      </section>

      {isShared ? (
        <section className="card">
          <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Pending Invites</div>
          <div className="simple-list">
            {isCollabLoading && <div className="crud-row"><SkeletonText lines={1} /></div>}
            {!isCollabLoading && !isCollabError && (collab.data?.invites ?? []).map((invite) => (
              <div key={invite.id} className="crud-row">
                <span>{invite.invitedEmail}</span>
                <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{new Date(invite.createdAt).toLocaleString()}</span>
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

      {isShared ? (
        <section className="card">
          <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Audit Logs</div>
          <div className="audit-timeline">
            {isCollabLoading && (
              <>
                <div className="audit-item"><SkeletonText lines={2} /></div>
                <div className="audit-item"><SkeletonText lines={2} /></div>
              </>
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

      {message ? (
        <section className="card" style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {message}
        </section>
      ) : null}
    </div>
  );
}
