"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import { ActionableAuthenticationMessage } from "@/components/reauthentication-message";

type Invite = {
  role: "EDITOR" | "VIEWER";
  status: string;
  expiresAt: string | null;
  workspace: { name: string };
  invitedBy: { name: string | null; email: string | null };
};

export function InvitationResponse({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [message, setMessage] = useState("Loading invitation…");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load invitation");
        setInvite(data);
        setMessage("");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load invitation"));
  }, [token]);

  const respond = async (action: "accept" | "decline") => {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to respond to invitation");
      if (data.accepted && data.workspaceId) {
        await fetch("/api/workspaces/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: data.workspaceId }),
        });
        router.push(buildWorkspacePath(data.workspaceId));
        router.refresh();
        return;
      }
      setInvite((current) => (current ? { ...current, status: "DECLINED" } : current));
      setMessage("Invitation declined.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to respond to invitation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card" style={{ display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-600)" }}>Workspace invitation</div>
        <h1 style={{ margin: "6px 0" }}>{invite?.workspace.name || "Nest"}</h1>
        {invite ? (
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>
            {invite.invitedBy.name || invite.invitedBy.email || "A workspace owner"} invited you as an {invite.role.toLowerCase()}.
          </p>
        ) : null}
      </div>
      {invite?.status === "PENDING" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={submitting} onClick={() => respond("accept")}>Accept</button>
          <button className="btn btn-ghost" disabled={submitting} onClick={() => respond("decline")}>Decline</button>
        </div>
      ) : null}
      {invite?.status && invite.status !== "PENDING" ? <p>This invitation is {invite.status.toLowerCase()}.</p> : null}
      <ActionableAuthenticationMessage message={message} className="invitation-response-message" />
    </section>
  );
}
