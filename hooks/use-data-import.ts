"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { MAX_IMPORT_ROWS_PER_CHUNK, type ImportedTransaction } from "@/lib/domains/integrations/import-contracts";
import { previewImport, type ImportPreview } from "@/lib/domains/integrations/import-preview";

type DuplicateRecord = {
  date: string;
  subject: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  notes: string | null;
  reason: "EXISTING_TRANSACTION" | "DUPLICATE_IN_PAYLOAD";
};

type ChunkResult = {
  imported: number;
  duplicates: number;
  duplicateRecords: DuplicateRecord[];
  failed: number;
  errors: string[];
  recalculated?: boolean;
};

type ImportProgress = {
  current: number;
  total: number;
  imported: number;
  duplicates: number;
  duplicateRecords: Array<DuplicateRecord & { id: string }>;
  failed: number;
  errors: Array<{ id: string; message: string }>;
};

type RecalculateResult = {
  recalculated: number;
  budgets: Array<{ id: string; name: string; previousCents: number; newCents: number; difference: number }>;
};

type ImportTarget = { workspaceId: string; accountId: string; budgetId: string; kind: string };
type ImportNotice = { message: string; tone: "success" | "danger" };

const CHUNK_SIZE = MAX_IMPORT_ROWS_PER_CHUNK;
const EMPTY_PROGRESS: ImportProgress = { current: 0, total: 0, imported: 0, duplicates: 0, duplicateRecords: [], failed: 0, errors: [] };

function importChunk(target: ImportTarget, transactions: ImportedTransaction[], chunkIndex: number, totalChunks: number, importRunId: string) {
  return apiFetch<ChunkResult>("/api/transactions/bulk-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `json-import:${importRunId}:${chunkIndex}`,
    },
    body: JSON.stringify({ ...target, transactions, chunkIndex, chunkSize: CHUNK_SIZE, totalChunks, importRunId, recalculate: true }),
  });
}

export function useDataImport(target: ImportTarget) {
  const queryClient = useQueryClient();
  const importRunRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const busyRef = useRef(false);
  const [jsonInput, setJsonInput] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [notice, setNotice] = useState<ImportNotice | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [recalcResult, setRecalcResult] = useState<RecalculateResult | null>(null);
  const busy = isImporting || isRecalculating;
  const canImport = Boolean(target.workspaceId && target.accountId && target.budgetId && preview && preview.valid > 0 && !busy);
  const canRecalculate = Boolean(target.workspaceId && target.budgetId && !busy);

  function invalidateFinancialQueries() {
    for (const name of ["transactions", "bank-accounts", "budgets", "dashboard-summary"] as const) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.key([name]) });
    }
  }

  function handleJsonChange(value: string) {
    if (busyRef.current) return;
    importRunRef.current = null;
    setJsonInput(value);
    setPreview(previewImport(value));
    setNotice(null);
    setRecalcResult(null);
    setProgress(EMPTY_PROGRESS);
  }

  async function handleImport() {
    if (busyRef.current) return;
    if (!target.workspaceId || !target.accountId || !target.budgetId) {
      setNotice({ message: "Please select Workspace, Bank Account, and Sub Account", tone: "danger" });
      return;
    }
    if (!preview || preview.valid === 0) {
      setNotice({ message: "No valid transactions to import", tone: "danger" });
      return;
    }
    busyRef.current = true;
    setIsImporting(true);
    setNotice(null);
    setRecalcResult(null);
    setProgress({ ...EMPTY_PROGRESS, total: preview.transactions.length });

    try {
      const totalTransactions = preview.transactions.length;
      const totalChunks = Math.ceil(totalTransactions / CHUNK_SIZE);
      const fingerprint = JSON.stringify({ ...target, transactions: preview.transactions });
      if (importRunRef.current?.fingerprint !== fingerprint) {
        importRunRef.current = { fingerprint, id: crypto.randomUUID() };
      }
      const importRunId = importRunRef.current.id;
      const aggregate: ImportProgress = { ...EMPTY_PROGRESS, total: totalTransactions, duplicateRecords: [], errors: [] };
      let balanceRecalculated = false;
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const startIndex = chunkIndex * CHUNK_SIZE;
        const chunk = preview.transactions.slice(startIndex, startIndex + CHUNK_SIZE);
        const result = await importChunk(target, chunk, chunkIndex, totalChunks, importRunId);
        aggregate.current += chunk.length;
        aggregate.imported += result.imported;
        aggregate.duplicates += result.duplicates;
        aggregate.failed += result.failed;
        aggregate.duplicateRecords.push(...result.duplicateRecords.map((record) => ({ ...record, id: crypto.randomUUID() })));
        aggregate.errors.push(...result.errors.map((message) => ({ id: crypto.randomUUID(), message })));
        balanceRecalculated = balanceRecalculated || result.recalculated === true;
        setProgress({ ...aggregate, duplicateRecords: [...aggregate.duplicateRecords], errors: aggregate.errors.slice(0, 5) });
      }
      const recalculationMessage = balanceRecalculated ? " Balance recalculated." : "";
      setNotice({
        message: `Import complete! Imported ${aggregate.imported} transactions. ${aggregate.duplicates} duplicates skipped. ${aggregate.failed} failed.${recalculationMessage}`,
        tone: aggregate.failed > 0 ? "danger" : "success",
      });
      setJsonInput("");
      setPreview(null);
      importRunRef.current = null;
    } catch (error) {
      setNotice({ message: `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`, tone: "danger" });
    } finally {
      busyRef.current = false;
      setIsImporting(false);
      invalidateFinancialQueries();
    }
  }

  async function handleRecalculate() {
    if (busyRef.current) return;
    if (!target.workspaceId || !target.budgetId) {
      setNotice({ message: "Please select Workspace and Sub Account", tone: "danger" });
      return;
    }
    busyRef.current = true;
    setIsRecalculating(true);
    setNotice(null);
    setRecalcResult(null);
    try {
      const result = await apiFetch<RecalculateResult>("/api/budgets/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: target.workspaceId, budgetId: target.budgetId }),
      });
      setRecalcResult(result);
      setNotice({ message: `Budget recalculated! ${result.budgets.length} budget(s) updated.`, tone: "success" });
    } catch (error) {
      setNotice({ message: `Recalculation failed: ${error instanceof Error ? error.message : "Unknown error"}`, tone: "danger" });
    } finally {
      busyRef.current = false;
      setIsRecalculating(false);
      invalidateFinancialQueries();
    }
  }

  return {
    jsonInput, preview, notice, isImporting, isRecalculating, progress, recalcResult, canImport, canRecalculate,
    handleJsonChange, handleImport, handleRecalculate, clearRecalculation: () => setRecalcResult(null),
  };
}
