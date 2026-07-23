"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useRef } from "react";
import { Upload, AlertCircle, CheckCircle, XCircle, Calculator } from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/controls";
import { bankAccountsQueryOptions, type BankAccount } from "@/lib/accounts";

interface DataImportSectionProps {
  workspaceId: string | null;
  baseCurrency: string;
}

type Context = {
  workspaces?: Array<{ id: string; name: string }>;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
};

type DuplicateRecord = {
  date: string;
  subject: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  notes: string | null;
  reason: "EXISTING_TRANSACTION" | "DUPLICATE_IN_PAYLOAD";
};

type ChunkResult = {
  success: boolean;
  imported: number;
  duplicates: number;
  duplicateRecords: DuplicateRecord[];
  failed: number;
  total: number;
  errors: string[];
  chunked: boolean;
  chunkIndex: number;
  processedCount: number;
  remainingCount: number;
  isComplete: boolean;
  recalculated?: boolean;
};

interface ImportPreview {
  valid: number;
  invalid: number;
  totalAmountCents: number;
  errors: string[];
  transactions: unknown[];
}

type RecalculateResult = {
  recalculated: number;
  budgets: Array<{
    id: string;
    name: string;
    previousCents: number;
    newCents: number;
    difference: number;
  }>;
};

const CHUNK_SIZE = 25; // Process 25 records at a time

export function DataImportSection({ workspaceId, baseCurrency }: DataImportSectionProps) {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const importRunRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>("");
  const [kind, setKind] = useState("Migration");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  // Progress state
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    imported: 0,
    duplicates: 0,
    duplicateRecords: [] as DuplicateRecord[],
    failed: 0,
    errors: [] as string[],
  });

  // Recalculate state
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalculateResult | null>(null);

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<Context>("/api/context"),
  });

  const activeWorkspaceId = selectedWorkspaceId || workspaceId || "";

  const accounts = useQuery(bankAccountsQueryOptions(activeWorkspaceId));

  const budgets = useQuery({
    queryKey: queryKeys.key(["budgets", activeWorkspaceId]),
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${activeWorkspaceId}`),
    enabled: Boolean(activeWorkspaceId),
  });

  const workspaces = context.data?.workspaces ?? [];

  // Filter active accounts and budgets
  const activeAccounts = useMemo(() => (accounts.data ?? []).filter((a) => a.isActive), [accounts.data]);
  const activeBudgets = useMemo(
    () => (budgets.data ?? []).filter((b) => b.isActive && b.accountId === selectedAccountId),
    [budgets.data, selectedAccountId],
  );

  // Parse and validate JSON
  const validateJson = (input: string): ImportPreview | null => {
    if (!input.trim()) return null;

    try {
      const data = JSON.parse(input);
      const transactions = data.Transactions || data.transactions || (Array.isArray(data) ? data : [data]);

      if (!Array.isArray(transactions)) {
        return { valid: 0, invalid: 0, totalAmountCents: 0, errors: ["Expected Transactions to be an array"], transactions: [] };
      }

      let valid = 0;
      let invalid = 0;
      let totalAmountCents = 0;
      const errors: string[] = [];
      const validTransactions: unknown[] = [];

      transactions.forEach((tx: unknown, index: number) => {
        if (typeof tx !== "object" || tx === null) {
          invalid++;
          errors.push(`Item ${index + 1}: Not a valid object`);
          return;
        }

        const t = tx as Record<string, unknown>;
        const missing: string[] = [];

        if (!t.Direction || (t.Direction !== "DEBIT" && t.Direction !== "CREDIT")) {
          missing.push("Direction (DEBIT or CREDIT)");
        }
        if (!t.Subject || typeof t.Subject !== "string") missing.push("Subject");
        if (!t.Date) missing.push("Date");
        if (typeof t.AmountCents !== "number" || t.AmountCents <= 0) {
          missing.push("AmountCents (positive number)");
        }

        if (missing.length > 0) {
          invalid++;
          errors.push(`Item ${index + 1}: Missing/invalid ${missing.join(", ")}`);
        } else {
          valid++;
          totalAmountCents += t.AmountCents as number;
          validTransactions.push(t);
        }
      });

      return { valid, invalid, totalAmountCents, errors, transactions: validTransactions };
    } catch (e) {
      return { valid: 0, invalid: 0, totalAmountCents: 0, errors: ["Invalid JSON: " + (e instanceof Error ? e.message : String(e))], transactions: [] };
    }
  };

  // Update preview when JSON changes
  const handleJsonChange = (value: string) => {
    importRunRef.current = null;
    setJsonInput(value);
    setPreview(validateJson(value));
    setMessage("");
    setRecalcResult(null);
    setProgress((current) => ({ ...current, duplicates: 0, duplicateRecords: [], errors: [] }));
  };

  const importChunk = useCallback(async (
    transactions: unknown[],
    chunkIndex: number,
    chunkSize: number,
    totalChunks: number,
    importRunId: string,
  ): Promise<ChunkResult> => {
    return fetchJson<ChunkResult>("/api/transactions/bulk-import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `json-import:${importRunId}:${chunkIndex}`,
      },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        accountId: selectedAccountId,
        budgetId: selectedBudgetId,
        kind,
        transactions,
        chunkIndex,
        chunkSize,
        totalChunks,
        importRunId,
        recalculate: true,
      }),
    });
  }, [activeWorkspaceId, selectedAccountId, selectedBudgetId, kind]);

  const invalidateFinancialQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.key(["transactions"]) });
    queryClient.invalidateQueries({ queryKey: queryKeys.key(["bank-accounts"]) });
    queryClient.invalidateQueries({ queryKey: queryKeys.key(["budgets"]) });
    queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]) });
  }, [queryClient]);

  const recalculateBudget = useCallback(
    (budgetId: string) =>
      fetchJson<RecalculateResult & { success: boolean }>("/api/budgets/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          budgetId,
        }),
      }),
    [activeWorkspaceId],
  );

  const handleImport = async () => {
    if (!activeWorkspaceId || !selectedAccountId || !selectedBudgetId) {
      setMessage("Please select Workspace, Bank Account, and Sub Account");
      return;
    }
    if (!preview || preview.valid === 0) {
      setMessage("No valid transactions to import");
      return;
    }

    setIsImporting(true);
    setMessage("");
    setRecalcResult(null);
    setProgress({
      current: 0,
      total: preview.transactions.length,
      imported: 0,
      duplicates: 0,
      duplicateRecords: [],
      failed: 0,
      errors: [],
    });

    try {
      const totalTransactions = preview.transactions.length;
      const totalChunks = Math.ceil(totalTransactions / CHUNK_SIZE);
      const fingerprint = JSON.stringify({
        workspaceId: activeWorkspaceId,
        accountId: selectedAccountId,
        budgetId: selectedBudgetId,
        kind,
        transactions: preview.transactions,
      });
      if (importRunRef.current?.fingerprint !== fingerprint) {
        importRunRef.current = { fingerprint, id: crypto.randomUUID() };
      }
      const importRunId = importRunRef.current.id;
      let totalImported = 0;
      let totalDuplicates = 0;
      const allDuplicateRecords: DuplicateRecord[] = [];
      let totalFailed = 0;
      const allErrors: string[] = [];
      const targetBudgetId = selectedBudgetId;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const startIndex = chunkIndex * CHUNK_SIZE;
        const endIndex = Math.min(startIndex + CHUNK_SIZE, totalTransactions);
        const chunkTransactions = preview.transactions.slice(startIndex, endIndex);

        setProgress((prev) => ({
          ...prev,
          current: startIndex,
        }));

        const result = await importChunk(
          chunkTransactions,
          chunkIndex,
          CHUNK_SIZE,
          totalChunks,
          importRunId,
        );

        totalImported += result.imported;
        totalDuplicates += result.duplicates;
        allDuplicateRecords.push(...result.duplicateRecords);
        totalFailed += result.failed;
        allErrors.push(...result.errors);

        setProgress({
          current: endIndex,
          total: totalTransactions,
          imported: totalImported,
          duplicates: totalDuplicates,
          duplicateRecords: allDuplicateRecords,
          failed: totalFailed,
          errors: allErrors.slice(0, 5), // Keep only first 5 errors
        });
      }

      let recalculationMessage = "";
      if (totalImported > 0) {
        setIsRecalculating(true);
        try {
          const recalculated = await recalculateBudget(targetBudgetId);
          setRecalcResult(recalculated);
          recalculationMessage = ` Budget recalculated (${recalculated.budgets.length} updated).`;
        } catch (error) {
          recalculationMessage = ` Recalculation failed: ${error instanceof Error ? error.message : "Unknown error"}`;
        } finally {
          setIsRecalculating(false);
        }
      }

      setMessage(`Import complete! Imported ${totalImported} transactions. ${totalDuplicates} duplicates skipped. ${totalFailed} failed.${recalculationMessage}`);
      setJsonInput("");
      setPreview(null);
      importRunRef.current = null;
      invalidateFinancialQueries();
    } catch (error) {
      setMessage(`Import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsImporting(false);
    }
  };

  const formatMoney = (cents: number) => {
    return `${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Determine if import button should be enabled
  const canImport =
    activeWorkspaceId &&
    selectedAccountId &&
    selectedBudgetId &&
    preview &&
    preview.valid > 0 &&
    !isImporting &&
    !isRecalculating;

  // Determine if recalculate button should be enabled
  const canRecalculate = activeWorkspaceId && selectedBudgetId && !isImporting && !isRecalculating;

  // Calculate progress percentage
  const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // Recalculate function
  const handleRecalculate = async () => {
    if (!activeWorkspaceId || !selectedBudgetId) {
      setMessage("Please select Workspace and Sub Account");
      return;
    }

    setIsRecalculating(true);
    setMessage("");
    setRecalcResult(null);

    try {
      const result = await recalculateBudget(selectedBudgetId);

      setRecalcResult(result);
      setMessage(`Budget recalculated! ${result.budgets.length} budget(s) updated.`);

      invalidateFinancialQueries();
    } catch (error) {
      setMessage(`Recalculation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsRecalculating(false);
    }
  };

  return (
    <div className="card settings-card-block settings-import-card">
      <div className="settings-card-header">
        <div>
          <div className="settings-section-title">Bulk Transaction Import</div>
          <div className="settings-section-copy">
            Import multiple transactions from JSON. Duplicates are detected by Date + Subject + Amount.
          </div>
        </div>
      </div>

      {/* Target Selection */}
      <div className="settings-import-fields">
        {/* Workspace */}
        {workspaces.length > 1 && (
          <div className="settings-field">
            <label>Workspace</label>
            <Select
              className="input"
              value={selectedWorkspaceId || workspaceId || ""}
              onChange={(e) => {
                setSelectedWorkspaceId(e.target.value);
                setSelectedAccountId("");
                setSelectedBudgetId("");
                setRecalcResult(null);
              }}
              disabled={!!workspaceId && workspaces.length === 1}
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
          <label>Bank Account</label>
          <Select
            className="input"
            value={selectedAccountId}
            onChange={(e) => {
              setSelectedAccountId(e.target.value);
              setSelectedBudgetId("");
              setRecalcResult(null);
            }}
            disabled={!activeWorkspaceId || accounts.isLoading || isImporting || isRecalculating}
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
          <label>Sub Account (Budget)</label>
          <Select
            className="input"
            value={selectedBudgetId}
            onChange={(e) => {
              setSelectedBudgetId(e.target.value);
              setRecalcResult(null);
            }}
            disabled={!selectedAccountId || budgets.isLoading || isImporting || isRecalculating}
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
          <label>Transaction Kind</label>
          <Select className="input" value={kind} onChange={(e) => setKind(e.target.value)} disabled={isImporting}>
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
        <label>JSON Data</label>
        <Textarea
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
          disabled={isImporting}
        />
        {preview && (
          <div className={`settings-import-preview ${preview.valid > 0 && preview.invalid === 0 ? "is-success" : preview.invalid > 0 ? "is-warning" : ""}`}>
            <div className="settings-import-preview-title">
              {preview.valid > 0 && preview.invalid === 0 ? (
                <>
                  <CheckCircle size={14} />
                  Valid: {preview.valid} transactions ({formatMoney(preview.totalAmountCents)} {baseCurrency})
                </>
              ) : preview.invalid > 0 ? (
                <>
                  <AlertCircle size={14} />
                  Valid: {preview.valid}, Invalid: {preview.invalid}
                </>
              ) : (
                <>
                  <XCircle size={14} />
                  No valid transactions found
                </>
              )}
            </div>
            {preview.errors.slice(0, 3).map((err, i) => (
              <div key={i} className="settings-import-preview-error">
                • {err}
              </div>
            ))}
            {preview.errors.length > 3 && (
              <div className="settings-import-preview-error">
                ...and {preview.errors.length - 3} more
              </div>
            )}
          </div>
        )}
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
        {jsonInput && !isImporting && (
          <Button className="btn btn-ghost" onClick={() => handleJsonChange("")}>
            Clear
          </Button>
        )}
      </div>

      {/* Progress Bar */}
      {isImporting && progress.total > 0 && (
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
      {!isImporting && message && (
        <div className={`settings-import-notice ${message.includes("failed") ? "is-danger" : message.includes("complete") ? "is-success" : ""}`}>
          {message}
        </div>
      )}

      {/* Error details from import */}
      {!isImporting && progress.errors.length > 0 && (
        <div className="settings-import-notice is-danger">
          <strong>Errors:</strong>
          {progress.errors.map((err, i) => (
            <div key={i}>• {err}</div>
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
            {progress.duplicateRecords.map((record, index) => (
              <div
                className="settings-import-duplicate-item"
                key={`${record.date}-${record.subject}-${record.amountCents}-${index}`}
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
          Duplicate detection: Transactions with the same Date + Subject + AmountCents will be skipped.
        </div>
      </details>
    </div>
  );
}
