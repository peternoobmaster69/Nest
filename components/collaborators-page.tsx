"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { SkeletonBlock, SkeletonText, EmptyState } from "@/components/ui-skeleton";

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  isCollaborative?: boolean;
  workspaces?: Array<{ id: string; name: string }>;
};

type CollaboratorData = {
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
    try {
      const payload = await res.json();
      throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
    } catch {
      throw new Error(`Request failed (${res.status})`);
    }
  }
  return res.json();
}

export function CollaboratorsPage() {
  const queryClient = useQueryClient();
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
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
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      fetchJson("/api/collaborators/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, email: inviteEmail }),
      }),
    onSuccess: async () => {
      setMessage("Invite sent.");
      setInviteEmail("");
      await queryClient.invalidateQueries({ queryKey: ["collaborators", workspaceId] });
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
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Failed to remove collaborator."),
  });

  const onCreateWorkspace = (event: FormEvent) => {
    event.preventDefault();
    if (!newWorkspaceName.trim()) return;
    createWorkspace.mutate();
  };

  const onInvite = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !inviteEmail.trim()) return;
    inviteMutation.mutate();
  };

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <section className="card">
        <div style={{ display: "grid", gap: "8px" }}>
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
                disabled={switchWorkspace.isPending}
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
            <button className="btn btn-primary btn-xs" type="submit" disabled={createWorkspace.isPending}>
              {createWorkspace.isPending ? "Creating..." : "+ Add Workspace"}
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <div style={{ display: "grid", gap: "8px" }}>
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
            <button className="btn btn-primary btn-xs" type="submit" disabled={!workspaceId || inviteMutation.isPending}>
              {inviteMutation.isPending ? "Sending..." : "Invite"}
            </button>
          </form>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Invites are sent by email. Existing Nest users are added immediately; others are added after they sign in with the invited email.
          </div>
        </div>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Collaborators</div>
        <div className="simple-list">
          {isCollabLoading && (
            <>
              <div className="crud-row">
                <SkeletonText lines={1} />
              </div>
              <div className="crud-row">
                <SkeletonText lines={1} />
              </div>
            </>
          )}

          {isCollabError && (
            <EmptyState
              icon="⚠️"
              title="Failed to load collaborators"
              action={
                <button className="btn btn-primary" onClick={() => refetchCollab()}>
                  Retry
                </button>
              }
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
                    disabled={removeMember.isPending}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {!isCollabLoading && !isCollabError && !(collab.data?.members?.length) && (
            <EmptyState
              icon="👥"
              title="No collaborators yet"
              description="Invite team members to collaborate on this workspace."
            />
          )}
        </div>
      </section>

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Pending Invites</div>
        <div className="simple-list">
          {isCollabLoading && (
            <>
              <div className="crud-row">
                <SkeletonText lines={1} />
              </div>
            </>
          )}
          {!isCollabLoading && !isCollabError && (collab.data?.invites ?? []).map((invite) => (
            <div key={invite.id} className="crud-row">
              <span>{invite.invitedEmail}</span>
              <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                {new Date(invite.createdAt).toLocaleString()}
              </span>
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

      <section className="card">
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Audit Logs</div>
        <div className="simple-list">
          {isCollabLoading && (
            <>
              <div className="crud-row">
                <SkeletonText lines={2} />
              </div>
              <div className="crud-row">
                <SkeletonText lines={2} />
              </div>
            </>
          )}
          {!isCollabLoading && !isCollabError && (collab.data?.auditLogs ?? []).map((log) => (
            <div key={log.id} className="crud-row" style={{ alignItems: "flex-start", gap: "6px" }}>
              <div style={{ display: "grid", gap: "1px" }}>
                <span>{log.details}</span>
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                  {log.actorUser?.name || log.actorUser?.email || "System"} · {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
          {!isCollabLoading && !isCollabError && !(collab.data?.auditLogs?.length) && (
            <EmptyState
              icon="📋"
              title="No audit logs yet"
              description="Activity in this workspace will be recorded here."
            />
          )}
        </div>
      </section>

      {message ? (
        <section className="card" style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {message}
        </section>
      ) : null}
    </div>
  );
}
