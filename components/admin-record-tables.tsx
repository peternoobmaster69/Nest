"use client";

import { cancelJobAction, retryJobAction } from "@/app/admin/job-actions";
import { AdminPagination, useAdminPagination } from "@/components/admin-pagination";
import type { getAdminOverview } from "@/lib/admin-overview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";

type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;

const DATE_FORMAT = new Intl.DateTimeFormat("en-SG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Singapore",
});

export function AdminRecentActivityTable({
  turns,
}: {
  turns: AdminOverview["recentTurns"];
}) {
  const pagination = useAdminPagination(turns.length);
  const visibleTurns = turns.slice(pagination.startIndex, pagination.endIndex);

  if (!turns.length) {
    return <p className="admin-empty">No Ask Nest interactions have been stored yet.</p>;
  }

  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table admin-responsive-table admin-activity-table">
          <caption className="sr-only">Recent Ask Nest activity</caption>
          <thead><tr><th scope="col">Time</th><th scope="col">User / workspace</th><th scope="col">Question</th><th scope="col">Context</th><th scope="col">Tokens</th><th scope="col">Grounding</th><th scope="col">Feedback</th></tr></thead>
          <tbody>
            {visibleTurns.map((turn) => (
              <tr key={turn.id}>
                <td data-label="Time"><time dateTime={turn.createdAt.toISOString()}>{DATE_FORMAT.format(turn.createdAt)}</time></td>
                <td data-label="User / workspace"><strong>{turn.userLabel}</strong><span>{turn.workspaceName}</span></td>
                <td data-label="Question" className="admin-question" title={turn.question}>{turn.question}</td>
                <td data-label="Context"><code>{turn.pagePath}</code></td>
                <td data-label="Tokens">{turn.totalTokens === null ? <span>Untracked</span> : <><strong>{turn.totalTokens.toLocaleString()} total</strong><span>{turn.inputTokens?.toLocaleString() ?? 0} in · {turn.outputTokens?.toLocaleString() ?? 0} out</span></>}</td>
                <td data-label="Grounding"><strong>{turn.toolsUsed.length ? turn.toolsUsed.join(", ") : "No tool metadata"}</strong><span>{turn.toolCallCount} calls · {turn.emptyResultCount} empty · {turn.durationMs === null ? "latency untracked" : `${turn.durationMs.toLocaleString()} ms`}</span><span>{turn.evidenceCount} evidence · {turn.memoryUpdateCount} memory updates</span></td>
                <td data-label="Feedback"><strong>{turn.feedbackRating?.replaceAll("_", " ") ?? "Not rated"}</strong>{turn.feedbackReason ? <span>{turn.feedbackReason.replaceAll("_", " ")}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminPagination
        label="Recent activity"
        totalItems={turns.length}
        page={pagination.page}
        onPageChange={pagination.setPage}
      />
    </>
  );
}

export function AdminBackgroundJobsTable({
  jobs,
}: {
  jobs: AdminOverview["backgroundJobs"]["recent"];
}) {
  const pagination = useAdminPagination(jobs.length);
  const visibleJobs = jobs.slice(pagination.startIndex, pagination.endIndex);

  if (!jobs.length) {
    return <p className="admin-empty">No background jobs have run yet.</p>;
  }

  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table admin-responsive-table">
          <caption className="sr-only">Recent background jobs</caption>
          <thead><tr><th scope="col">Job</th><th scope="col">Scope</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Attempts</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {visibleJobs.map((job) => (
              <tr key={job.id}>
                <td data-label="Job"><strong>{job.type.replaceAll("_", " ")}</strong><span>{job.id}</span></td>
                <td data-label="Scope"><strong>{job.workspaceId ?? "System"}</strong><span>{job.userId ? `Actor ${job.userId}` : job.key ?? "No actor"}</span></td>
                <td data-label="Status"><strong>{job.status.replaceAll("_", " ")}</strong><span>{job.errorCode ?? job.message ?? "—"}</span></td>
                <td data-label="Progress">{job.progress}%<span>{job.current ?? 0} / {job.total ?? 0}</span></td>
                <td data-label="Attempts">{job.attempts}<span>{job.retryCount} retries · {job.duplicateCount} suppressed</span></td>
                <td data-label="Updated"><time dateTime={job.updatedAt.toISOString()}>{DATE_FORMAT.format(job.updatedAt)}</time></td>
                <td data-label="Actions">
                  <div className="admin-job-actions">
                    {["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.status) ? <form action={retryJobAction}><Input type="hidden" name="jobId" value={job.id} /><Button className="btn btn-ghost btn-xs" type="submit">Retry</Button></form> : null}
                    {["PENDING", "RUNNING"].includes(job.status) ? <form action={cancelJobAction}><Input type="hidden" name="jobId" value={job.id} /><Button className="btn btn-ghost btn-xs" type="submit">Cancel</Button></form> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminPagination
        label="Background jobs"
        totalItems={jobs.length}
        page={pagination.page}
        onPageChange={pagination.setPage}
      />
    </>
  );
}
