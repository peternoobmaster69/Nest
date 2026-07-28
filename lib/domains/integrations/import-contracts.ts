import { z } from "zod";

const MAX_IMPORT_ROWS_PER_CHUNK = 250;
export const MAX_MAYBANK_ROWS_PER_CHUNK = 500;

export const ImportMaybankSchema = z.object({
  creditCardId: z.string().trim().min(1).max(191),
  csvContent: z.string().min(1).max(512 * 1024),
  importRunId: z.string().trim().min(8).max(100).optional(),
  chunkIndex: z.number().int().min(0).max(10_000).default(0),
  totalChunks: z.number().int().min(1).max(10_000).default(1),
}).refine((value) => value.chunkIndex < value.totalChunks, {
  message: "chunkIndex must be smaller than totalChunks",
  path: ["chunkIndex"],
});

const ImportedTransactionSchema = z.object({
  AccountName: z.string().trim().max(200).optional(),
  Direction: z.enum(["DEBIT", "CREDIT"]),
  Subject: z.string().trim().min(1).max(500),
  Date: z.string().trim().min(8).max(40),
  AmountCents: z.number().int().positive().max(2_147_483_647),
  Details: z.string().trim().max(2_000).optional(),
  Notes: z.string().trim().max(2_000).optional(),
});

export const BulkImportSchema = z.object({
  workspaceId: z.string().trim().min(1).max(191),
  accountId: z.string().trim().min(1).max(191),
  budgetId: z.string().trim().min(1).max(191),
  kind: z.string().trim().min(1).max(50).default("Migration"),
  transactions: z.array(ImportedTransactionSchema).min(1).max(MAX_IMPORT_ROWS_PER_CHUNK),
  importRunId: z.string().trim().min(8).max(100).optional(),
  chunkIndex: z.number().int().min(0).max(10_000).optional(),
  totalChunks: z.number().int().min(1).max(10_000).optional(),
  chunkSize: z.number().int().min(1).max(MAX_IMPORT_ROWS_PER_CHUNK).optional(),
  recalculate: z.boolean().default(true),
}).refine(
  (value) => value.chunkIndex === undefined || value.totalChunks === undefined || value.chunkIndex < value.totalChunks,
  { message: "chunkIndex must be smaller than totalChunks", path: ["chunkIndex"] },
);

export type ImportedTransaction = z.infer<typeof ImportedTransactionSchema>;
export type MaybankImportInput = z.infer<typeof ImportMaybankSchema>;
