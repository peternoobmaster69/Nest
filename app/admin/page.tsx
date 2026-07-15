import { Bot, Brain, HardDrive, KeyRound, ShieldCheck, Sigma } from "lucide-react";
import { AdminDirectories } from "@/components/admin-directories";
import { PageFrame } from "@/components/page-frame";
import { requireAdminPage } from "@/lib/admin-auth";
import { getAdminOverview } from "@/lib/admin-overview";

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

export default async function AdminPage() {
  const session = await requireAdminPage();
  const overview = await getAdminOverview();
  const userName = session.user?.name || session.user?.email || "Administrator";

  return (
    <PageFrame
      title="Admin"
      current="/admin"
      userName={userName}
      userEmail={session.user?.email || undefined}
      userImage={session.user?.image || null}
    >
      <div className="admin-page">
        <section className="admin-hero">
          <div>
            <div className="admin-eyebrow"><ShieldCheck size={15} aria-hidden="true" /> Restricted administration</div>
            <h1>System overview</h1>
          </div>
          <time dateTime={overview.generatedAt.toISOString()}>Updated {DATE_FORMAT.format(overview.generatedAt)}</time>
        </section>

        <AdminDirectories users={overview.users} workspaces={overview.workspaces} />

        <section className="admin-stats admin-ai-stats" aria-label="Ask Nest totals">
          <article className="admin-stat"><Bot aria-hidden="true" /><span>Ask Nest turns</span><strong>{overview.stats.totalTurns.toLocaleString()}</strong><small>{overview.stats.recentTurnCount.toLocaleString()} in the last 7 days</small></article>
          <article className="admin-stat"><Brain aria-hidden="true" /><span>Active memories</span><strong>{overview.stats.activeMemoryCount.toLocaleString()}</strong><small>{overview.stats.inactiveMemoryCount.toLocaleString()} inactive</small></article>
          <article className="admin-stat"><Sigma aria-hidden="true" /><span>Tracked tokens</span><strong>{overview.tokenUsage.allTime.totalTokens.toLocaleString()}</strong><small>{overview.tokenUsage.last7Days.totalTokens.toLocaleString()} in the last 7 days · {overview.tokenUsage.trackedTurnCount.toLocaleString()} tracked turns</small></article>
          <article className="admin-stat"><HardDrive aria-hidden="true" /><span>Database storage</span><strong>{overview.databaseStorage ? formatStorage(overview.databaseStorage.totalAllocatedMb) : "Unavailable"}</strong><small>{overview.databaseStorage ? `${formatStorage(overview.databaseStorage.dataUsedMb)} data used · ${formatStorage(overview.databaseStorage.logAllocatedMb)} log allocated` : "Storage metadata could not be read"}</small></article>
        </section>

        <section className="card admin-panel admin-token-panel">
          <div className="admin-panel-heading"><div><h2>Ask Nest usage and estimated cost</h2><p>Sum of model responses, including any tool-call rounds. Older turns recorded before token tracking are excluded.</p></div><Sigma size={19} aria-hidden="true" /></div>
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
        </section>

        <div className="admin-grid">
          <section className="card admin-panel">
            <div className="admin-panel-heading"><div><h2>Server configuration</h2><p>Presence checks only; secrets never leave the server.</p></div><KeyRound size={19} aria-hidden="true" /></div>
            <dl className="admin-config-list">
              <div><dt>Administrator</dt><dd className={overview.configuration.adminConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.adminConfigured)}</dd></div>
              <div><dt>AI endpoint</dt><dd className={overview.configuration.aiEndpointConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.aiEndpointConfigured)}</dd></div>
              <div><dt>AI API key</dt><dd className={overview.configuration.aiKeyConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.aiKeyConfigured)}</dd></div>
              <div><dt>AI cost rates</dt><dd className={overview.configuration.aiCostRatesConfigured ? "is-good" : "is-bad"}>{statusLabel(overview.configuration.aiCostRatesConfigured)}</dd></div>
              <div><dt>AI model</dt><dd>{overview.configuration.aiModel || "Not configured"}</dd></div>
              <div><dt>Ask Nest history</dt><dd>{overview.configuration.askNestHistoryRetentionDays} days</dd></div>
            </dl>
          </section>

          <section className="card admin-panel">
            <div className="admin-panel-heading"><div><h2>Memory distribution</h2><p>Active memories grouped by type.</p></div><Brain size={19} aria-hidden="true" /></div>
            {overview.memoryKinds.length ? (
              <div className="admin-memory-list">
                {overview.memoryKinds.map((entry) => (
                  <div key={entry.kind}><span>{entry.kind.replaceAll("_", " ")}</span><strong>{entry.count.toLocaleString()}</strong></div>
                ))}
              </div>
            ) : <p className="admin-empty">No active memories yet.</p>}
          </section>
        </div>

        <section className="card admin-panel admin-activity">
          <div className="admin-panel-heading"><div><h2>Recent Ask Nest activity</h2><p>Latest successful, persisted interactions across workspaces.</p></div></div>
          {overview.recentTurns.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Time</th><th>User / workspace</th><th>Question</th><th>Context</th><th>Tokens</th><th>Grounding</th></tr></thead>
                <tbody>
                  {overview.recentTurns.map((turn) => (
                    <tr key={turn.id}>
                      <td><time dateTime={turn.createdAt.toISOString()}>{DATE_FORMAT.format(turn.createdAt)}</time></td>
                      <td><strong>{turn.userLabel}</strong><span>{turn.workspaceName}</span></td>
                      <td className="admin-question" title={turn.question}>{turn.question}</td>
                      <td><code>{turn.pagePath}</code></td>
                      <td>{turn.totalTokens === null ? <span>Untracked</span> : <><strong>{turn.totalTokens.toLocaleString()} total</strong><span>{turn.inputTokens?.toLocaleString() ?? 0} in · {turn.outputTokens?.toLocaleString() ?? 0} out</span></>}</td>
                      <td><strong>{turn.toolsUsed.length ? turn.toolsUsed.join(", ") : "No tool metadata"}</strong><span>{turn.evidenceCount} evidence · {turn.memoryUpdateCount} memory updates</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="admin-empty">No Ask Nest interactions have been stored yet.</p>}
        </section>
      </div>
    </PageFrame>
  );
}
