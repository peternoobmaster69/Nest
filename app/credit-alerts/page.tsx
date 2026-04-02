import { PageFrame } from "@/components/page-frame";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/require-session";
import { requireWorkspaceAccess } from "@/lib/workspace-auth";

function formatDateTime(value: Date | null) {
  if (!value) return "—";
  return value.toLocaleString();
}

function formatAmount(cents: number | null, currency: string | null) {
  if (cents === null) return "—";
  const amount = (cents / 100).toFixed(2);
  return `${currency || ""} ${amount}`.trim();
}

export default async function CreditAlertsRoute() {
  const session = await requireSession();
  const userName = session.user?.name || session.user?.email || "User";
  const { workspaceId } = await requireWorkspaceAccess();

  const staged = await prisma.cardAlertStaging.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      source: true,
      rawSubject: true,
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

  return (
    <PageFrame title="Credit Alert Staging" current="/credit-alerts" userName={userName} userImage={session.user?.image || null}>
      <div className="card">
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700 }}>Recent Gmail / Email Alert Staging</div>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Latest 100 staged alert rows for the current workspace.
          </div>
        </div>

        <div className="cct-table-wrapper">
          <table className="cct-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Source</th>
                <th>Subject</th>
                <th>Bank</th>
                <th>Card</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Txn Date</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {staged.map((row, index) => (
                <tr key={`${row.createdAt.toISOString()}-${index}`}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.parseStatus}</td>
                  <td>{row.source}</td>
                  <td>{row.rawSubject || "—"}</td>
                  <td>{row.bankName || "—"}</td>
                  <td>{row.cardLast4 ? `••${row.cardLast4}` : "—"}</td>
                  <td>{row.merchant || "—"}</td>
                  <td>{formatAmount(row.amountCents, row.currency)}</td>
                  <td>{formatDateTime(row.transactionDate)}</td>
                  <td>{row.failureReason || "—"}</td>
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
      </div>
    </PageFrame>
  );
}
