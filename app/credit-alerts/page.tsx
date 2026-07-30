import { PageFrame } from "@/components/page-frame";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";
import { DataValue, MobileDataCard } from "@/components/ui/data-view";
import { formatMoney } from "@/lib/currency";
import { formatLocalDateTime } from "@/lib/presentation";
import { openFailedCreditAlertBody } from "@/lib/credit-alert-diagnostics";

function formatDateTime(value: Date | null) {
  if (!value) return "—";
  return formatLocalDateTime(value);
}

function formatAmount(cents: number | null, currency: string | null) {
  if (cents === null) return "—";
  return formatMoney(cents, currency);
}

export default async function CreditAlertsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";
  const { workspaceId } = await requireWorkspaceAccess(null, "OWNER");

  const storedAlerts = await prisma.cardAlertStaging.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      source: true,
      rawSubject: true,
      rawBody: true,
      sourceMessageKey: true,
      bankName: true,
      transactionRef: true,
      currency: true,
      amountCents: true,
      transactionDate: true,
      merchant: true,
      cardLast4: true,
      parseStatus: true,
      failureReason: true,
      creditTransactionId: true,
      createdAt: true,
      processedAt: true,
    },
  });
  const staged = storedAlerts.map(({ rawBody, sourceMessageKey, ...alert }) => ({
    ...alert,
    diagnosticBody: alert.parseStatus === "FAILED"
      ? openFailedCreditAlertBody({ workspaceId, sourceMessageKey, storedBody: rawBody })
      : null,
  }));

  return (
    <PageFrame title="Credit Alert Staging" current="/credit-alerts" userName={userName} userEmail={session.user?.email || undefined} userImage={session.user?.image || null}>
      <div className="card">
        <div className="section-label" style={{ marginBottom: "12px" }}>
          Showing {staged.length} most recent staged {staged.length === 1 ? "alert" : "alerts"}
        </div>
        <p className="credit-alert-retention-note">
          Failed parser samples are encrypted and retained temporarily for diagnosis (seven days by default).
        </p>

        <div className="cct-table-wrapper desktop-data-table">
          <table className="cct-table">
            <caption className="sr-only">Most recent staged credit alerts and parsing outcomes</caption>
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                <th scope="col">Source</th>
                <th scope="col">Subject</th>
                <th scope="col">Bank</th>
                <th scope="col">Card</th>
                <th scope="col">Merchant</th>
                <th scope="col">Amount</th>
                <th scope="col">Txn Date</th>
                <th scope="col">Failure</th>
              </tr>
            </thead>
            <tbody>
              {staged.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.parseStatus}</td>
                  <td>{row.source}</td>
                  <td>{row.rawSubject || "—"}</td>
                  <td>{row.bankName || "—"}</td>
                  <td>{row.cardLast4 ? `••${row.cardLast4}` : "—"}</td>
                  <td>{row.merchant || "—"}</td>
                  <td>{formatAmount(row.amountCents, row.currency)}</td>
                  <td>{formatDateTime(row.transactionDate)}</td>
                  <td>
                    {row.failureReason || "—"}
                    {row.diagnosticBody ? (
                      <details className="credit-alert-diagnostic">
                        <summary>View retained body</summary>
                        <pre>{row.diagnosticBody}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
              {staged.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "24px" }}>
                    No staged alerts found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mobile-data-list">
          {staged.map((row) => (
            <MobileDataCard key={`${row.id}-mobile`}>
              <div className="mobile-data-card-head">
                <strong>{row.merchant || row.bankName || "Card alert"}</strong>
                <span className={`badge ${row.parseStatus === "PARSED" || row.parseStatus === "PROCESSED" ? "badge-success" : "badge-warning"}`}>
                  {row.parseStatus}
                </span>
              </div>
              <DataValue label="Amount" priority="high">{formatAmount(row.amountCents, row.currency)}</DataValue>
              <DataValue label="Card">{row.cardLast4 ? `••${row.cardLast4}` : "—"}</DataValue>
              <DataValue label="Created">{formatDateTime(row.createdAt)}</DataValue>
              {row.failureReason ? <DataValue label="Failure" priority="low">{row.failureReason}</DataValue> : null}
              {row.diagnosticBody ? (
                <details className="credit-alert-diagnostic">
                  <summary>View retained body</summary>
                  <pre>{row.diagnosticBody}</pre>
                </details>
              ) : null}
            </MobileDataCard>
          ))}
          {staged.length === 0 ? <div className="empty-state"><p className="empty-state-desc">No staged alerts found.</p></div> : null}
        </div>
      </div>
    </PageFrame>
  );
}
