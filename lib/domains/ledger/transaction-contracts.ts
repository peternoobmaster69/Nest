import { z } from "zod";

export const CorrectTransactionSchema = z.object({
  subject: z.string().min(1).max(120).optional(),
  amountCents: z.number().int().positive().optional(),
  direction: z.enum(["DEBIT", "CREDIT"]).optional(),
  kind: z.enum(["EXPENSE", "INCOME", "ADJUSTMENT"]).optional(),
  details: z.string().max(500).nullable().optional(),
  notes: z.string().nullable().optional(),
  date: z.string().datetime().optional(),
  budgetId: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).refine(
  ({ reason: _reason, ...replacement }) => Object.values(replacement).some((value) => value !== undefined),
  { message: "Provide at least one corrected transaction field." },
);

export type CorrectTransactionInput = z.infer<typeof CorrectTransactionSchema>;
