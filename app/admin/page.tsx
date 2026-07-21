import { Bot, Brain, ChevronDown, Gauge, HardDrive, KeyRound, ListRestart, Sigma, ThumbsUp } from "lucide-react";
import { AdminDirectories } from "@/components/admin-directories";
import { PageFrame } from "@/components/page-frame";
import { requireAdminPage } from "@/lib/admin-auth";
import { getAdminOverview } from "@/lib/admin-overview";
import { cancelJobAction, retryJobAction } from "@/app/admin/job-actions";

export const dynamic = "force-dynamic";

const DATE_FORMAT = new Intl.DateTimeFormat("en-SG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Singapore",
});

function statusLabel(configured: boolean) {
  return configured ? "Configured" : "Missing";
}

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatUsd(value: number) {
  return value > 0 && value < 0.0001 ? "< $0.0001" : USD_FORMAT.format(value);
}

function formatStorage(megabytes: number) {
  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toLocaleString("en-US", { maximumFractionDigits: 2 })} GB`;
  }
  return `${megabytes.toLocaleString("en-US", { maximumFractionDigits: 2 })} MB`;
}

function formatPercent(value: number) {
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1000)} sec`;
  return `${Math.round(milliseconds / 60_000)} min`;
}

export default async function AdminPage() {
  const session = await requireAdminPage();
  const overview = await getAdminOverview();
  const userName = session.user?.name || session.user?.email || "Administrator";
  const missingCoreConfigurationCount = [
    overview.configuration.adminConfigured,
    overview.configuration.aiEndpointConfigured,
    overview.configuration.aiKeyConfigured,
  ].filter((configured) => !configured).length;

  return (
    <PageFrame
      title="Admin"
      current="/admin"
      userName={userName}
      userEmail={session.user?.email || undefined}
      userImage={session.user?.image || null}
    >
      <div className="admin-page">
        <section className="admin-group" aria-labelledby="admin-access-title">
          <h2 className="admin-group-title" id="admin-access-title">Access</h2>
          <AdminDirectories users={overview.users} workspaces={overview.workspaces} />
        </section>

        <section className="admin-group" aria-labelledby="admin-ask-nest-title">
          <h2 className="admin-group-title" id="admin-ask-nest-title">Ask Nest</h2>

          <section className="admin-stats admin-ai-stats" aria-label="Ask Nest totals">
            <article className="admin-stat"><Bot aria-hidden="true" /><span>Turns</span><strong>{overview.stats.totalTurns.toLocaleString()}</strong><small>{overview.stats.recentTurnCount.toLocaleString()} / 7d</small></article>
            <article className="admin-stat"><Brain aria-hidden="true" /><span>Active memories</span><strong>{overview.stats.activeMemoryCount.toLocaleString()}</strong><small>{overview.stats.inactiveMemoryCount.toLocaleString()} inactive</small></article>
            <article className="admin-stat"><Gauge aria-hidden="true" /><span>Tool calls</span><strong>{overview.quality.toolCallCount.toLocaleString()}</strong><small>{formatPercent(overview.quality.emptyResultRate)} empty</small></article>
            <article className="admin-stat"><ThumbsUp aria-hidden="true" /><span>Helpful</span><strong>{overview.quality.feedbackCount ? formatPercent(overview.quality.helpfulRate) : "—"}</strong><small>{overview.quality.feedbackCount.toLocaleString()} ratings</small></article>
          </section>

          <div className="admin-disclosure-list">
            <details className="card admin-panel admin-disclosure">
              <summary>
                <span className="admin-disclosure-heading"><Sigma size={19} aria-hidden="true" /><strong>Usage &amp; cost</strong></span>
                <ChevronDown className="admin-disclosure-chevron" size={19} aria-hidden="true" />
              </summary>
              <div className="admin-disclosure-body admin-token-panel">
                <div className="admin-token-breakdown">
                  <div><span>All-time input</span><strong>{overview.tokenUsage.allTime.inputTokens.toLocaleString()}</strong></div>
                  <div><span>All-time output</span><strong>{overview.tokenUsage.allTime.outputTokens.toLocaleString()}</strong></div>
                  <div><span>Last 7 days input</span><strong>{overview.tokenUsage.last7Days.inputTokens.toLocaleString()}</strong></div>
                  <div><span>Last 7 days output</span><strong>{overview.tokenUsage.last7Days.outputTokens.toLocaleString()}</strong></div>
                </div>
                {overview.tokenUsage.estimatedCost ? (
                  <>
                    <div className="admin-cost-breakdown">
                      <div><span>All-time estimated cost</span><strong>{formatUsd(overview.tokenUsage.estimatedCost.allTime.totalCostUsd)}</strong></div>
                      <div><span>Last 7 days estimated cost</span><strong>{formatUsd(overview.tokenUsage.estimatedCost.last7Days.totalCostUsd)}</strong></div>
                    </div>
                    <p className="admin-cost-note">Using configured rates: {formatUsd(overview.tokenUsage.estimatedCost.rates.inputPerMillionUsd)} per 1M input tokens and {formatUsd(overview.tokenUsage.estimatedCost.rates.outputPerMillionUsd)} per 1M output tokens. This is an estimate, not an Azure invoice.</p>
                  </>
                ) : <p className="admin-cost-note">Cost estimates are unavailable. Set <code>AI_WORKLOAD_INPUT_COST_PER_1M_USD</code> and <code>AI_WORKLOAD_OUTPUT_COST_PER_1M_USD</code> in <code>.env</code> with your Azure deployment&apos;s USD rates.</p>}
              </div>
            </details>

            <details className="card admin-panel admin-disclosure">
              <summary>
                <span className="admin-disclosure-heading"><Brain size={19} aria-hidden="true" /><strong>Memory</strong></span>
                <ChevronDown className="admin-disclosure-chevron" size={19} aria-hidden="true" />
              </summary>
              <div className="admin-disclosure-body">
                {overview.memoryKinds.length ? (
                  <div className="admin-memory-list">
                    {overview.memoryKinds.map((entry) => (
                      <div key={entry.kind}><span>{entry.kind.replaceAll("_", " ")}</span><strong>{entry.count.toLocaleString()}</strong></div>
                    ))}
                  </div>
                ) : <p className="admin-empty">No active memories yet.</p>}
              </div>
            </details>

            <details className="card admin-panel admin-disclosure admin-activity">
              <summary>
                <span className="admin-disclosure-heading"><Bot size={19} aria-hidden="true" /><strong>Recent activity</strong></span>
                <ChevronDown className="admin-disclosure-chevron" size={19} aria-hidden="true" />
              </summary>
              <div className="admin-disclosure-body">
                {overview.recentTurns.length ? (
                  <div className="admin-table-wrap">
                    <table className="admin-table admin-responsive-table admin-activity-table">
                      <thead><tr><th>Time</th><th>User / workspace</th><th>Question</th><th>Context</th><th>Tokens</th><th>Grounding</th><th>Feedback</th></tr></thead>
                      <tbody>
                        {overview.recentTurns.map((turn) => (
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
                ) : <p className="admin-empty">No Ask Nest interactions have been stored yet.</p>}
              </div>
            </details>
          </div>
        </section>

        <section className="admin-group" aria-labelledby="admin-system-title">
          <h2 className="admin-group-title" id="admin-system-title">System</h2>

          <section className="admin-stats admin-system-stats" aria-label="System health">
            <article className={`admin-stat${missingCoreConfigurationCount ? " admin-stat-alert" : ""}`}><KeyRound aria-hidden="true" /><span>Configuration</span><strong>{missingCoreConfigurationCount ? `${missingCoreConfigurationCount} missing` : "Ready"}</strong></article>
            <article className="admin-stat"><HardDrive aria-hidden="true" /><span>Database</span><strong>{overview.databaseStorage ? formatStorage(overview.databaseStorage.totalAllocatedMb) : "—"}</strong>{overview.databaseStorage ? <small>{formatStorage(overview.databaseStorage.dataUsedMb)} used</small> : null}</article>
            <article className={`admin-stat${overview.backgroundJobs.metrics.deadLetters ? " admin-stat-alert" : ""}`}><ListRestart aria-hidden="true" /><span>Background jobs</span><strong>{overview.backgroundJobs.metrics.queued} queued</strong><small>{overview.backgroundJobs.metrics.deadLetters} dead letters</small></article>
          </section>

          <details className="card admin-panel admin-disclosure">
            <summary>
              <span className="admin-disclosure-heading"><ListRestart size={19} aria-hidden="true" /><strong>Background jobs</strong></span>
              <ChevronDown className="admin-disclosure-chevron" size={19} aria-hidden="true" />
            </summary>
            <div className="admin-disclosure-body">
              <div className="admin-token-breakdown">
                <div><span>Queue age</span><strong>{formatDuration(overview.backgroundJobs.metrics.queueAgeMs)}</strong></div>
                <div><span>Average duration</span><strong>{formatDuration(overview.backgroundJobs.metrics.averageDurationMs)}</strong></div>
                <div><span>Success / 7d</span><strong>{formatPercent(overview.backgroundJobs.metrics.successRate)}</strong></div>
                <div><span>Retries</span><strong>{overview.backgroundJobs.metrics.retries.toLocaleString()}</strong></div>
                <div><span>Duplicates suppressed</span><strong>{overview.backgroundJobs.metrics.duplicateSuppressions.toLocaleString()}</strong></div>
                <div><span>Dead letters</span><strong>{overview.backgroundJobs.metrics.deadLetters.toLocaleString()}</strong></div>
              </div>
              {overview.backgroundJobs.recent.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-responsive-table">
                    <thead><tr><th>Job</th><th>Scope</th><th>Status</th><th>Progress</th><th>Attempts</th><th>Updated</th><th>Actions</th></tr></thead>
                    <tbody>{overview.backgroundJobs.recent.map((job) => (
                      <tr key={job.id}>
                        <td data-label="Job"><strong>{job.type.replaceAll("_", " ")}</strong><span>{job.id}</span></td>
                        <td data-label="Scope"><strong>{job.workspaceId ?? "System"}</strong><span>{job.userId ? `Actor ${job.userId}` : job.key ?? "No actor"}</span></td>
                        <td data-label="Status"><strong>{job.status.replaceAll("_", " ")}</strong><span>{job.errorCode ?? job.message ?? "—"}</span></td>
                        <td data-label="Progress">{job.progress}%<span>{job.current ?? 0} / {job.total ?? 0}</span></td>
                        <td data-label="Attempts">{job.attempts}<span>{job.retryCount} retries · {job.duplicateCount} suppressed</span></td>
                        <td data-label="Updated"><time dateTime={job.updatedAt.toISOString()}>{DATE_FORMAT.format(job.updatedAt)}</time></td>
                        <td data-label="Actions">
                          <div className="admin-job-actions">
                            {["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.status) ? <form action={retryJobAction}><input type="hidden" name="jobId" value={job.id} /><button className="btn btn-ghost btn-xs" type="submit">Retry</button></form> : null}
                            {["PENDING", "RUNNING"].includes(job.status) ? <form action={cancelJobAction}><input type="hidden" name="jobId" value={job.id} /><button className="btn btn-ghost btn-xs" type="submit">Cancel</button></form> : null}
                          </div>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="admin-empty">No background jobs have run yet.</p>}
            </div>
          </details>

          <details className="card admin-panel admin-disclosure">
            <summary>
              <span className="admin-disclosure-heading"><KeyRound size={19} aria-hidden="true" /><strong>Configuration</strong></span>
              <ChevronDown className="admin-disclosure-chevron" size={19} aria-hidden="true" />
            </summary>
            <div className="admin-disclosure-body">
              <dl className="admin-config-list">
                <div><dt>Administrator</dt><dd className={overview.configuration.adminConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.adminConfigured)}</dd></div>
                <div><dt>AI endpoint</dt><dd className={overview.configuration.aiEndpointConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.aiEndpointConfigured)}</dd></div>
                <div><dt>AI API key</dt><dd className={overview.configuration.aiKeyConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.aiKeyConfigured)}</dd></div>
                <div><dt>AI cost rates</dt><dd className={overview.configuration.aiCostRatesConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.aiCostRatesConfigured)}</dd></div>
                <div><dt>AI model</dt><dd>{overview.configuration.aiModel || "Not configured"}</dd></div>
                <div><dt>Ask Nest history</dt><dd>{overview.configuration.askNestHistoryRetentionDays} days</dd></div>
                <div><dt>Knowledge search</dt><dd className={overview.configuration.askNestSearch.active ? "is-good" : ""}>{overview.configuration.askNestSearch.reason.replaceAll("_", " ")}</dd></div>
              </dl>
            </div>
          </details>
        </section>
      </div>
    </PageFrame>
  );
}
