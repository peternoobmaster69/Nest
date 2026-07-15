"use client";

import { Building2, Users } from "lucide-react";
import { useState } from "react";
import type { getAdminOverview } from "@/lib/admin-overview";

type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;
type Directory = "users" | "workspaces";

const DATE_FORMAT = new Intl.DateTimeFormat("en-SG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Singapore",
});

export function AdminDirectories({
  users,
  workspaces,
}: {
  users: AdminOverview["users"];
  workspaces: AdminOverview["workspaces"];
}) {
  const [openDirectory, setOpenDirectory] = useState<Directory | null>(null);

  const toggleDirectory = (directory: Directory) => {
    setOpenDirectory((current) => current === directory ? null : directory);
  };

  return (
    <>
      <section className="admin-stats admin-directory-stats" aria-label="Account directories">
        <button
          type="button"
          className={`admin-stat admin-stat-button${openDirectory === "users" ? " is-open" : ""}`}
          onClick={() => toggleDirectory("users")}
          aria-expanded={openDirectory === "users"}
          aria-controls="admin-users"
        >
          <Users aria-hidden="true" /><span>Users</span><strong>{users.length.toLocaleString()}</strong><small>{openDirectory === "users" ? "Hide user details" : "View user details"}</small>
        </button>
        <button
          type="button"
          className={`admin-stat admin-stat-button${openDirectory === "workspaces" ? " is-open" : ""}`}
          onClick={() => toggleDirectory("workspaces")}
          aria-expanded={openDirectory === "workspaces"}
          aria-controls="admin-workspaces"
        >
          <Building2 aria-hidden="true" /><span>Workspaces</span><strong>{workspaces.length.toLocaleString()}</strong><small>{openDirectory === "workspaces" ? "Hide workspace details" : "View workspace details"}</small>
        </button>
      </section>

      {openDirectory === "users" ? (
        <section id="admin-users" className="card admin-panel admin-directory">
          <div className="admin-panel-heading"><div><h2>Users</h2><p>Registered accounts and their workspace access.</p></div><span className="admin-count-badge">{users.length.toLocaleString()}</span></div>
          {users.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table admin-directory-table">
                <thead><tr><th>User</th><th>Joined</th><th>Workspace access</th><th>Ask Nest</th><th>Sessions</th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td><strong>{user.name || "Unnamed user"}</strong><span>{user.email || "No email"}</span><code title={user.id}>{user.id}</code></td>
                      <td><time dateTime={user.createdAt.toISOString()}>{DATE_FORMAT.format(user.createdAt)}</time></td>
                      <td>
                        {user.memberships.length ? (
                          <div className="admin-memberships">
                            {user.memberships.map((membership) => (
                              <div key={membership.workspaceId}>
                                <strong>{membership.workspaceName}</strong>
                                <span className="admin-role-badge">{membership.role}</span>
                                {user.activeWorkspaceId === membership.workspaceId ? <span className="admin-active-badge">Active</span> : null}
                              </div>
                            ))}
                          </div>
                        ) : <span>No workspace access</span>}
                      </td>
                      <td><strong>{user.counts.askNestTurns.toLocaleString()} turns</strong><span>{user.counts.askNestMemories.toLocaleString()} memories</span></td>
                      <td>{user.counts.sessions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="admin-empty">No registered users.</p>}
        </section>
      ) : null}

      {openDirectory === "workspaces" ? (
        <section id="admin-workspaces" className="card admin-panel admin-directory">
          <div className="admin-panel-heading"><div><h2>Workspaces</h2><p>Workspace membership, configuration, and record counts.</p></div><span className="admin-count-badge">{workspaces.length.toLocaleString()}</span></div>
          {workspaces.length ? (
            <div className="admin-workspace-list">
              {workspaces.map((workspace) => (
                <article className="admin-workspace" key={workspace.id}>
                  <div className="admin-workspace-head">
                    <div><h3>{workspace.name}</h3><code title={workspace.id}>{workspace.id}</code></div>
                    <div className="admin-workspace-tags"><span>{workspace.baseCurrency}</span><span>{workspace.isShared ? "Shared" : "Private"}</span></div>
                  </div>
                  <dl className="admin-workspace-counts">
                    <div><dt>Members</dt><dd>{workspace.counts.members}</dd></div>
                    <div><dt>Accounts</dt><dd>{workspace.counts.financials}</dd></div>
                    <div><dt>Transactions</dt><dd>{workspace.counts.transactions}</dd></div>
                    <div><dt>Budgets</dt><dd>{workspace.counts.budgetEnvelopes}</dd></div>
                    <div><dt>Cards</dt><dd>{workspace.counts.creditCards}</dd></div>
                    <div><dt>Receivables</dt><dd>{workspace.counts.receivables}</dd></div>
                    <div><dt>Investments</dt><dd>{workspace.counts.investmentAccounts}</dd></div>
                    <div><dt>Ask Nest</dt><dd>{workspace.counts.askNestTurns}</dd></div>
                    <div><dt>Memories</dt><dd>{workspace.counts.askNestMemories}</dd></div>
                  </dl>
                  <div className="admin-workspace-meta">
                    <span>Created {DATE_FORMAT.format(workspace.createdAt)}</span>
                    <span>Updated {DATE_FORMAT.format(workspace.updatedAt)}</span>
                  </div>
                  <div className="admin-workspace-members">
                    <h4>Members</h4>
                    {workspace.members.length ? workspace.members.map((member) => (
                      <div key={member.userId}>
                        <span><strong>{member.userName || member.userEmail || "Unnamed user"}</strong>{member.userName && member.userEmail ? <small>{member.userEmail}</small> : null}</span>
                        <span className="admin-role-badge">{member.role}</span>
                      </div>
                    )) : <p>No members.</p>}
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="admin-empty">No workspaces.</p>}
        </section>
      ) : null}
    </>
  );
}
