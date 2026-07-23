"use client";

import { Building2, ChevronDown, Users } from "lucide-react";
import { useState } from "react";
import { AdminPagination, useAdminPagination } from "@/components/admin-pagination";
import type { getAdminOverview } from "@/lib/admin-overview";
import { Button } from "@/components/ui/button";

type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;
type Directory = "users" | "workspaces";

const DATE_FORMAT = new Intl.DateTimeFormat("en-SG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Singapore",
});

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function loginLocation(countryCode: string | null, ipAddress: string | null) {
  const country = countryCode
    ? REGION_NAMES.of(countryCode) ?? countryCode
    : "Country unavailable";
  return `${country} · ${ipAddress ?? "IP unavailable"}`;
}

export function AdminDirectories({
  users,
  workspaces,
}: {
  users: AdminOverview["users"];
  workspaces: AdminOverview["workspaces"];
}) {
  const [openDirectory, setOpenDirectory] = useState<Directory | null>(null);
  const userPagination = useAdminPagination(users.length);
  const workspacePagination = useAdminPagination(workspaces.length);
  const visibleUsers = users.slice(userPagination.startIndex, userPagination.endIndex);
  const visibleWorkspaces = workspaces.slice(workspacePagination.startIndex, workspacePagination.endIndex);

  const toggleDirectory = (directory: Directory) => {
    setOpenDirectory((current) => current === directory ? null : directory);
  };

  return (
    <>
      <section className="admin-stats admin-directory-stats" aria-label="Account directories">
        <Button
          type="button"
          className={`admin-stat admin-stat-button${openDirectory === "users" ? " is-open" : ""}`}
          onClick={() => toggleDirectory("users")}
          aria-expanded={openDirectory === "users"}
          aria-controls="admin-users"
        >
          <Users aria-hidden="true" /><span>Users</span><strong>{users.length.toLocaleString()}</strong>
        </Button>
        <Button
          type="button"
          className={`admin-stat admin-stat-button${openDirectory === "workspaces" ? " is-open" : ""}`}
          onClick={() => toggleDirectory("workspaces")}
          aria-expanded={openDirectory === "workspaces"}
          aria-controls="admin-workspaces"
        >
          <Building2 aria-hidden="true" /><span>Workspaces</span><strong>{workspaces.length.toLocaleString()}</strong>
        </Button>
      </section>

      {openDirectory === "users" ? (
        <section id="admin-users" className="card admin-panel admin-directory">
          <div className="admin-panel-heading"><h2>Users</h2></div>
          {users.length ? (
            <>
              <div className="admin-table-wrap admin-directory-table-wrap">
                <table className="admin-table admin-directory-table admin-users-table">
                  <colgroup>
                    <col className="admin-user-column" />
                    <col className="admin-joined-column" />
                    <col className="admin-signin-column" />
                    <col className="admin-access-column" />
                    <col className="admin-ask-column" />
                  </colgroup>
                  <thead><tr><th>User</th><th>Joined</th><th>Last signed in</th><th>Workspace access</th><th>Ask Nest</th></tr></thead>
                  <tbody>
                    {visibleUsers.map((user) => (
                      <tr key={user.id}>
                        <td data-label="User">
                          <strong>{user.name || "Unnamed user"}</strong>
                          <span>{user.email || "No email"}</span>
                          <details className="admin-inline-details"><summary>ID</summary><code title={user.id}>{user.id}</code></details>
                        </td>
                        <td data-label="Joined"><time dateTime={user.createdAt.toISOString()}>{DATE_FORMAT.format(user.createdAt)}</time></td>
                        <td data-label="Last signed in">
                          {user.lastSignedInAt
                            ? <time dateTime={user.lastSignedInAt.toISOString()}>{DATE_FORMAT.format(user.lastSignedInAt)}</time>
                            : <span>Never</span>}
                          {user.latestLoginSession ? (
                            <span
                              className="admin-login-location"
                              title={loginLocation(user.latestLoginSession.countryCode, user.latestLoginSession.ipAddress)}
                            >
                              {loginLocation(user.latestLoginSession.countryCode, user.latestLoginSession.ipAddress)}
                            </span>
                          ) : null}
                        </td>
                        <td data-label="Workspace access">
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
                        <td data-label="Ask Nest"><strong>{user.counts.askNestTurns.toLocaleString()} turns</strong><span>{user.counts.askNestMemories.toLocaleString()} memories</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AdminPagination
                label="Users"
                totalItems={users.length}
                page={userPagination.page}
                onPageChange={userPagination.setPage}
              />
            </>
          ) : <p className="admin-empty">No registered users.</p>}
        </section>
      ) : null}

      {openDirectory === "workspaces" ? (
        <section id="admin-workspaces" className="card admin-panel admin-directory">
          <div className="admin-panel-heading"><h2>Workspaces</h2></div>
          {workspaces.length ? (
            <>
              <div className="admin-workspace-list">
                {visibleWorkspaces.map((workspace) => (
                  <article className="admin-workspace" key={workspace.id}>
                  <div className="admin-workspace-head">
                    <div><h3>{workspace.name}</h3></div>
                    <div className="admin-workspace-tags"><span>{workspace.baseCurrency}</span><span>{workspace.isShared ? "Shared" : "Private"}</span></div>
                  </div>
                  <dl className="admin-workspace-counts admin-workspace-primary-counts">
                    <div><dt>Members</dt><dd>{workspace.counts.members}</dd></div>
                    <div><dt>Accounts</dt><dd>{workspace.counts.financials}</dd></div>
                    <div><dt>Transactions</dt><dd>{workspace.counts.transactions}</dd></div>
                  </dl>
                  <details className="admin-workspace-details">
                    <summary><span>Details</span><ChevronDown size={16} aria-hidden="true" /></summary>
                    <div className="admin-workspace-details-body">
                      <code className="admin-workspace-id" title={workspace.id}>{workspace.id}</code>
                      <dl className="admin-workspace-counts admin-workspace-secondary-counts">
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
                    </div>
                  </details>
                  </article>
                ))}
              </div>
              <AdminPagination
                label="Workspaces"
                totalItems={workspaces.length}
                page={workspacePagination.page}
                onPageChange={workspacePagination.setPage}
              />
            </>
          ) : <p className="admin-empty">No workspaces.</p>}
        </section>
      ) : null}
    </>
  );
}
