"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { Upload, AlertCircle, CheckCircle, XCircle, FileJson, Calculator } from "lucide-react";

interface DataImportSectionProps {
  workspaceId: string | null;
  baseCurrency: string;
}

type Context = {
  workspaces?: Array<{ id: string; name: string }>;
};

type BankAccount = {
  id: string;
  name: string;
  bankName: string | null;
  isActive: boolean;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  isActive: boolean;
};

type ChunkResult = {
  success: boolean;
  imported: number;
  duplicates: number;
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      detail = payload?.message || payload?.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export function DataImportSection({ workspaceId, baseCurrency }: DataImportSectionProps) {
  const queryClient = useQueryClient();
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
    failed: 0,
    errors: [] as string[],
  });

  // Recalculate state
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalculateResult | null>(null);

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<Context>("/api/context"),
  });

  const activeWorkspaceId = selectedWorkspaceId || workspaceId || "";

  const accounts = useQuery({
    queryKey: ["bank-accounts", activeWorkspaceId],
    queryFn: () => fetchJson<BankAccount[]>(`/api/accounts?workspaceId=${activeWorkspaceId}`),
    enabled: Boolean(activeWorkspaceId),
  });

  const budgets = useQuery({
    queryKey: ["budgets", activeWorkspaceId],
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
    setJsonInput(value);
    setPreview(validateJson(value));
    setMessage("");
    setRecalcResult(null);
  };

  const importChunk = useCallback(async (
    transactions: unknown[],
    chunkIndex: number,
    chunkSize: number,
  ): Promise<ChunkResult> => {
    return fetchJson<ChunkResult>("/api/transactions/bulk-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        accountId: selectedAccountId,
        budgetId: selectedBudgetId,
        kind,
        transactions,
        chunkIndex,
        chunkSize,
        recalculate: false,
      }),
    });
  }, [activeWorkspaceId, selectedAccountId, selectedBudgetId, kind]);

  const invalidateFinancialQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["budgets"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
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
      failed: 0,
      errors: [],
    });

    try {
      const totalTransactions = preview.transactions.length;
      const totalChunks = Math.ceil(totalTransactions / CHUNK_SIZE);
      let totalImported = 0;
      let totalDuplicates = 0;
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

        const result = await importChunk(chunkTransactions, chunkIndex, CHUNK_SIZE);

        totalImported += result.imported;
        totalDuplicates += result.duplicates;
        totalFailed += result.failed;
        allErrors.push(...result.errors);

        setProgress({
          current: endIndex,
          total: totalTransactions,
          imported: totalImported,
          duplicates: totalDuplicates,
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
    <div className="card" style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "12px" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
            <FileJson size={16} />
            Bulk Transaction Import
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Import multiple transactions from JSON. Duplicates are detected by Date + Subject + Amount.
          </div>
        </div>
      </div>

      {/* Target Selection */}
      <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
        {/* Workspace */}
        {workspaces.length > 1 && (
          <div>
            <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
              Workspace
            </label>
            <select
              className="input"
              style={{ maxWidth: "100%" }}
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
            </select>
            {!workspaceId && !selectedWorkspaceId && (
              <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--warning-600)" }}>
                <AlertCircle size={12} />
                Select a workspace first
              </div>
            )}
          </div>
        )}

        {/* Bank Account */}
        <div>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
            Bank Account
          </label>
          <select
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
          </select>
        </div>

        {/* Sub Account (Budget) */}
        <div>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
            Sub Account (Budget)
          </label>
          <select
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
          </select>
          {selectedAccountId && activeBudgets.length === 0 && !budgets.isLoading && (
            <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--warning-600)" }}>
              <AlertCircle size={12} />
              No active sub accounts for this bank account
            </div>
          )}
        </div>

        {/* Kind */}
        <div>
          <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
            Transaction Kind
          </label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} disabled={isImporting}>
            <option value="Migration">Migration</option>
            <option value="Adjustment">Adjustment</option>
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
            <option value="TRANSFER">Transfer</option>
          </select>
        </div>
      </div>

      {/* JSON Input */}
      <div style={{ marginBottom: "12px" }}>
        <label style={{ fontSize: "12px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
          JSON Data
        </label>
        <textarea
          className="input"
          rows={8}
          placeholder={`Paste JSON here, e.g.:
{
  "Transactions": [
    {
      "AccountName": "Savings",
      "Direction": "CREDIT",
      "Subject": "Salary",
      "Date": "2026-04-03",
      "AmountCents": 500000
    }
  ]
}`}
          value={jsonInput}
          onChange={(e) => handleJsonChange(e.target.value)}
          disabled={isImporting}
          style={{ fontFamily: "monospace", fontSize: "12px" }}
        />
        {preview && (
          <div
            style={{
              marginTop: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              backgroundColor:
                preview.valid > 0 && preview.invalid === 0
                  ? "var(--success-50)"
                  : preview.invalid > 0
                  ? "var(--warning-50)"
                  : "var(--bg-secondary)",
              color:
                preview.valid > 0 && preview.invalid === 0
                  ? "var(--success-700)"
                  : preview.invalid > 0
                  ? "var(--warning-700)"
                  : "var(--text-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 500 }}>
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
              <div key={i} style={{ marginTop: "4px", marginLeft: "20px", fontSize: "11px" }}>
                • {err}
              </div>
            ))}
            {preview.errors.length > 3 && (
              <div style={{ marginTop: "4px", marginLeft: "20px", fontSize: "11px" }}>
                ...and {preview.errors.length - 3} more
              </div>
            )}
          </div>
        )}
      </div>

      {/* Import and Recalculate Buttons */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        <button className="btn btn-primary" onClick={handleImport} disabled={!canImport}>
          <Upload size={14} style={{ marginRight: "6px" }} />
          {isImporting ? "Importing..." : "Import Transactions"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleRecalculate}
          disabled={!canRecalculate}
          title="Recalculate budget total based on existing transactions"
        >
          <Calculator size={14} style={{ marginRight: "6px" }} />
          {isRecalculating ? "Calculating..." : "Recalculate"}
        </button>
        {jsonInput && !isImporting && (
          <button className="btn btn-ghost" onClick={() => handleJsonChange("")}>
            Clear
          </button>
        )}
      </div>

      {/* Progress Bar */}
      {isImporting && progress.total > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Importing... {progress.current} of {progress.total} records
            </span>
            <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--brand-600)" }}>
              {progressPercent}%
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: "4px",
              backgroundColor: "var(--bg-subtle)",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                backgroundColor: "var(--brand-500)",
                borderRadius: "2px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ marginTop: "8px", display: "flex", gap: "16px", fontSize: "11px", color: "var(--text-tertiary)" }}>
            <span>Imported: {progress.imported}</span>
            <span>Duplicates: {progress.duplicates}</span>
            {progress.failed > 0 && <span style={{ color: "var(--danger-600)" }}>Failed: {progress.failed}</span>}
          </div>
        </div>
      )}

      {/* Result Message */}
      {!isImporting && message && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            backgroundColor: message.includes("complete")
              ? message.includes("failed")
                ? "var(--danger-50)"
                : "var(--success-50)"
              : message.includes("failed")
              ? "var(--danger-50)"
              : "var(--bg-secondary)",
            color: message.includes("complete")
              ? message.includes("failed")
                ? "var(--danger-700)"
                : "var(--success-700)"
              : message.includes("failed")
              ? "var(--danger-700)"
              : "var(--text-secondary)",
          }}
        >
          {message}
        </div>
      )}

      {/* Error details from import */}
      {!isImporting && progress.errors.length > 0 && (
        <div style={{ marginTop: "8px", padding: "8px 12px", borderRadius: "6px", fontSize: "11px", backgroundColor: "var(--danger-50)", color: "var(--danger-700)" }}>
          <strong>Errors:</strong>
          {progress.errors.map((err, i) => (
            <div key={i} style={{ marginTop: "2px" }}>• {err}</div>
          ))}
          {progress.errors.length < progress.failed && (
            <div style={{ marginTop: "2px" }}>...and {progress.failed - progress.errors.length} more</div>
          )}
        </div>
      )}

      {/* Recalculate Results */}
      {!isRecalculating && recalcResult && (
        <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "var(--bg-subtle)", borderRadius: "6px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>
            Recalculation Results
          </div>
          {recalcResult.budgets.map((budget) => (
            <div
              key={budget.id}
              style={{
                padding: "8px",
                backgroundColor: "var(--bg-secondary)",
                borderRadius: "4px",
                marginBottom: "4px",
                fontSize: "12px",
              }}
            >
              <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>{budget.name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", color: "var(--text-tertiary)" }}>
                <span>Previous: {formatMoney(budget.previousCents)}</span>
                <span>
                  New:{" "}
                  <span style={{ color: budget.newCents >= 0 ? "var(--success-600)" : "var(--danger-600)", fontWeight: 500 }}>
                    {formatMoney(budget.newCents)}
                  </span>
                </span>
              </div>
              {budget.difference !== 0 && (
                <div
                  style={{
                    marginTop: "2px",
                    fontSize: "11px",
                    color: budget.difference >= 0 ? "var(--success-600)" : "var(--danger-600)",
                  }}
                >
                  Difference: {budget.difference >= 0 ? "+" : ""}
                  {formatMoney(budget.difference)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Help Text */}
      <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "var(--bg-subtle)", borderRadius: "6px", fontSize: "11px", color: "var(--text-tertiary)" }}>
        <strong>Expected JSON format:</strong>
        <ul style={{ margin: "8px 0 0 0", paddingLeft: "16px" }}>
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
        <div style={{ marginTop: "8px" }}>
          Duplicate detection: Transactions with the same Date + Subject + AmountCents will be skipped.
        </div>
      </div>
    </div>
  );
}
