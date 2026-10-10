import { ImportedTransactionSchema, type ImportedTransaction } from "@/lib/domains/integrations/import-contracts";

export type ImportPreview = {
  valid: number;
  invalid: number;
  totalAmountCents: number;
  errors: string[];
  transactions: ImportedTransaction[];
};

function transactionRows(data: unknown): unknown {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    if ("Transactions" in data) return data.Transactions;
    if ("transactions" in data) return data.transactions;
  }
  return [data];
}

export function previewImport(input: string): ImportPreview | null {
  if (!input.trim()) return null;
  const preview: ImportPreview = { valid: 0, invalid: 0, totalAmountCents: 0, errors: [], transactions: [] };
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    preview.errors.push("Invalid JSON: check the syntax and try again.");
    return preview;
  }
  const transactions = transactionRows(data);
  if (!Array.isArray(transactions)) {
    preview.errors.push("Expected Transactions to be an array");
    return preview;
  }
  transactions.forEach((tx, index) => {
    const parsed = ImportedTransactionSchema.safeParse(tx);
    if (!parsed.success) {
      preview.invalid++;
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "transaction"}: ${issue.message}`)
        .join(", ");
      preview.errors.push(`Item ${index + 1}: ${details}`);
    } else {
      preview.valid++;
      preview.totalAmountCents += parsed.data.AmountCents;
      preview.transactions.push(parsed.data);
    }
  });
  return preview;
}
