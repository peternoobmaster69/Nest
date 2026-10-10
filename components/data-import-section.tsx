"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Upload, AlertCircle, CheckCircle, XCircle, Calculator } from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import { useMoneyFormat } from "@/lib/use-money-format";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/controls";
import { bankAccountsQueryOptions } from "@/lib/accounts";
import { useDataImport } from "@/hooks/use-data-import";
import type { ImportPreview } from "@/lib/domains/integrations/import-preview";

interface DataImportSectionProps {
  workspaceId: string | null;
  baseCurrency: string;
}

type Context = { workspaces?: Array<{ id: string; name: string }> };
type Budget = { id: string; accountId: string; name: string; isActive: boolean };

function ImportPreviewPanel({ preview, formatMoney, baseCurrency }: Readonly<{
  preview: ImportPreview;
  formatMoney: (cents: number) => string;
  baseCurrency: string;
}>) {
  let tone = "";
  let Icon = XCircle;
  let title = "No valid transactions found";
  if (preview.invalid > 0) {
    tone = "is-warning";
    Icon = AlertCircle;
    title = `Valid: ${preview.valid}, Invalid: ${preview.invalid}`;
  } else if (preview.valid > 0) {
    tone = "is-success";
    Icon = CheckCircle;
    title = `Valid: ${preview.valid} transactions (${formatMoney(preview.totalAmountCents)} ${baseCurrency})`;
  }
  return (
    <div className={`settings-import-preview ${tone}`}>
      <div className="settings-import-preview-title"><Icon size={14} />{title}</div>
      {preview.errors.slice(0, 3).map((error) => (
        <div key={error} className="settings-import-preview-error">• {error}</div>
      ))}
      {preview.errors.length > 3 && (
        <div className="settings-import-preview-error">...and {preview.errors.length - 3} more</div>
      )}
    </div>
  );
}

export function DataImportSection({ workspaceId, baseCurrency }: Readonly<DataImportSectionProps>) {
  const routeWorkspaceId = useWorkspaceId();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedBudgetId, setSelectedBudgetId] = useState("");
  const [kind, setKind] = useState("Migration");
  const activeWorkspaceId = selectedWorkspaceId || workspaceId || "";
  const {
    jsonInput, preview, notice, isImporting, isRecalculating, progress, recalcResult, canImport, canRecalculate,
    handleJsonChange, handleImport, handleRecalculate, clearRecalculation,
  } = useDataImport({ workspaceId: activeWorkspaceId, accountId: selectedAccountId, budgetId: selectedBudgetId, kind });
  const busy = isImporting || isRecalculating;
  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<Context>("/api/context"),
  });
  const accounts = useQuery(bankAccountsQueryOptions(activeWorkspaceId));
  const budgets = useQuery({
    queryKey: queryKeys.key(["budgets", activeWorkspaceId]),
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${activeWorkspaceId}`),
    enabled: Boolean(activeWorkspaceId),
  });
  const workspaces = context.data?.workspaces ?? [];
  const activeAccounts = useMemo(() => (accounts.data ?? []).filter((account) => account.isActive), [accounts.data]);
  const activeBudgets = useMemo(
    () => (budgets.data ?? []).filter((budget) => budget.isActive && budget.accountId === selectedAccountId),
    [budgets.data, selectedAccountId],
  );
  const { mask } = useMoneyFormat();
  const formatMoney = (cents: number) => mask((cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="card settings-card-block settings-import-card">
      <div className="settings-card-header">
        <div>
          <div className="settings-section-title">Bulk Transaction Import</div>
          <div className="settings-section-copy">
            Import multiple transactions from JSON. Migration preserves every row; other kinds skip duplicates.
          </div>
        </div>
      </div>

      {/* Target Selection */}
      <div className="settings-import-fields">
        {/* Workspace */}
        {workspaces.length > 1 && (
          <div className="settings-field">
            <label htmlFor="data-import-section-selected-workspace-id-workspace-id">Workspace</label>
            <Select id="data-import-section-selected-workspace-id-workspace-id"
              className="input"
              value={activeWorkspaceId}
              onChange={(e) => {
                setSelectedWorkspaceId(e.target.value);
                setSelectedAccountId("");
                setSelectedBudgetId("");
                clearRecalculation();
              }}
              disabled={busy}
            >
              <option value="">Select workspace</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            {!workspaceId && !selectedWorkspaceId && (
              <div className="settings-field-hint is-warning">
                <AlertCircle size={12} />
                Select a workspace first
              </div>
            )}
          </div>
        )}

        {/* Bank Account */}
        <div className="settings-field">
          <label htmlFor="data-import-section-selected-account-id">Bank Account</label>
          <Select id="data-import-section-selected-account-id"
            className="input"
            value={selectedAccountId}
            onChange={(e) => {
              setSelectedAccountId(e.target.value);
              setSelectedBudgetId("");
              clearRecalculation();
            }}
            disabled={!activeWorkspaceId || accounts.isLoading || busy}
          >
            <option value="">Select bank account</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} {account.bankName ? `(${account.bankName})` : ""}
              </option>
            ))}
          </Select>
        </div>

        {/* Sub Account (Budget) */}
        <div className="settings-field">
          <label htmlFor="data-import-section-selected-budget-id">Sub Account (Budget)</label>
          <Select id="data-import-section-selected-budget-id"
            className="input"
            value={selectedBudgetId}
            onChange={(e) => {
              setSelectedBudgetId(e.target.value);
              clearRecalculation();
            }}
            disabled={!selectedAccountId || budgets.isLoading || busy}
          >
            <option value="">Select sub account</option>
            {activeBudgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
              </option>
            ))}
          </Select>
          {selectedAccountId && activeBudgets.length === 0 && !budgets.isLoading && (
            <div className="settings-field-hint is-warning">
              <AlertCircle size={12} />
              No active sub accounts for this bank account
            </div>
          )}
        </div>

        {/* Kind */}
        <div className="settings-field">
          <label htmlFor="data-import-section-kind">Transaction Kind</label>
          <Select id="data-import-section-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
            <option value="Migration">Migration</option>
            <option value="Adjustment">Adjustment</option>
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
            <option value="TRANSFER">Transfer</option>
          </Select>
        </div>
      </div>

      {/* JSON Input */}
      <div className="settings-field settings-json-field">
        <label htmlFor="import-json-data">JSON Data</label>
        <Textarea id="import-json-data"
          className="input settings-json-input"
          rows={8}
          placeholder={`Paste JSON here, e.g.:
{
  "Transactions": [
    {
      "AccountName": "Childcare",
      "Direction": "CREDIT",
      "Subject": "Baby Fund",
      "Date": "2021-04-21",
      "AmountCents": 150000,
      "Notes": "Auto Credit"
    }
  ]
}`}
          value={jsonInput}
          onChange={(e) => handleJsonChange(e.target.value)}
          disabled={busy}
        />
        {preview && <ImportPreviewPanel preview={preview} formatMoney={formatMoney} baseCurrency={baseCurrency} />}
      </div>

      {/* Import and Recalculate Buttons */}
      <div className="settings-card-actions settings-import-actions">
        <Button className="btn btn-primary" onClick={handleImport} disabled={!canImport}>
          <Upload size={16} aria-hidden="true" />
          {isImporting ? "Importing..." : "Import Transactions"}
        </Button>
        <Button
          className="btn btn-ghost"
          onClick={handleRecalculate}
          disabled={!canRecalculate}
          title="Recalculate budget total based on existing transactions"
        >
          <Calculator size={16} aria-hidden="true" />
          {isRecalculating ? "Calculating..." : "Recalculate"}
        </Button>
        {jsonInput && !busy && (
          <Button className="btn btn-ghost" onClick={() => handleJsonChange("")}>
            Clear
          </Button>
        )}
      </div>

      {/* Progress Bar */}
      {isImporting && (
        <div className="settings-import-progress">
          <div className="settings-import-progress-head">
            <span>
              Importing... {progress.current} of {progress.total} records
            </span>
            <strong>
              {progressPercent}%
            </strong>
          </div>
          <div className="settings-import-progress-track">
            <div
              className="settings-import-progress-value"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="settings-import-progress-stats">
            <span>Imported: {progress.imported}</span>
            <span>Duplicates: {progress.duplicates}</span>
            {progress.failed > 0 && <span className="is-danger">Failed: {progress.failed}</span>}
          </div>
        </div>
      )}

      {/* Result Message */}
      {!isImporting && notice && (
        <div className={`settings-import-notice is-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.message}
        </div>
      )}

      {/* Error details from import */}
      {!isImporting && progress.errors.length > 0 && (
        <div className="settings-import-notice is-danger">
          <strong>Errors:</strong>
          {progress.errors.map((error) => (
            <div key={error.id}>• {error.message}</div>
          ))}
          {progress.errors.length < progress.failed && (
            <div>...and {progress.failed - progress.errors.length} more</div>
          )}
        </div>
      )}

      {/* Duplicate details from import */}
      {!isImporting && progress.duplicateRecords.length > 0 && (
        <details className="settings-import-duplicates" open>
          <summary>Skipped duplicates ({progress.duplicateRecords.length})</summary>
          <div className="settings-import-duplicate-list">
            {progress.duplicateRecords.map((record) => (
              <div
                className="settings-import-duplicate-item"
                key={record.id}
              >
                <div>
                  <strong>{record.subject}</strong>
                  <span>{record.date}</span>
                  {record.notes ? <span>Notes: {record.notes}</span> : null}
                </div>
                <div className="settings-import-duplicate-meta">
                  <strong>{record.direction === "CREDIT" ? "+" : "−"}{formatMoney(record.amountCents)} {baseCurrency}</strong>
                  <span>
                    {record.reason === "EXISTING_TRANSACTION"
                      ? "Already exists in this subaccount"
                      : "Repeated in uploaded JSON"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Recalculate Results */}
      {!isRecalculating && recalcResult && (
        <div className="settings-recalculation-results">
          <div className="settings-recalculation-title">
            Recalculation Results
          </div>
          {recalcResult.budgets.map((budget) => (
            <div key={budget.id} className="settings-recalculation-item">
              <strong>{budget.name}</strong>
              <div className="settings-recalculation-values">
                <span>Previous: {formatMoney(budget.previousCents)}</span>
                <span>
                  New:{" "}
                  <span className={budget.newCents >= 0 ? "is-positive" : "is-negative"}>
                    {formatMoney(budget.newCents)}
                  </span>
                </span>
              </div>
              {budget.difference !== 0 && (
                <div className={`settings-recalculation-difference ${budget.difference >= 0 ? "is-positive" : "is-negative"}`}>
                  Difference: {budget.difference >= 0 ? "+" : ""}
                  {formatMoney(budget.difference)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      <details className="settings-import-help">
        <summary>Expected JSON format</summary>
        <ul>
          <li>
            <code>Direction</code>: &quot;DEBIT&quot; (outgoing) or &quot;CREDIT&quot; (incoming)
          </li>
          <li>
            <code>Subject</code>: Transaction description
          </li>
          <li>
            <code>Date</code>: YYYY-MM-DD (transactions are matched by day)
          </li>
          <li>
            <code>AmountCents</code>: Positive integer (e.g., 5000 for $50.00)
          </li>
          <li>Optional: <code>Details</code>, <code>Notes</code>, <code>AccountName</code> (for reference)</li>
        </ul>
        <div className="settings-import-help-note">
          {kind === "Migration"
            ? "Migration imports preserve every supplied row, including repeated transactions."
            : "Duplicate detection: Transactions with the same Date + Subject + AmountCents will be skipped."}
        </div>
      </details>
    </div>
  );
}
