import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).nullable();
export const TransactionIntentSchema = z.object({
  operation: z.enum(["CREATE", "UPDATE", "CANCEL", "CLARIFY", "UNSUPPORTED"]),
  amount: text(32),
  direction: z.enum(["DEBIT", "CREDIT"]).nullable(),
  accountQuery: text(120),
  // Names copied from the supplied sub-account list that plausibly match. Hints only: never a selection.
  accountCandidates: z.array(z.string().trim().max(120)).max(5),
  bankQuery: text(120),
  subject: text(120),
  date: text(10),
  currency: text(8),
  targetQuery: text(120),
  targetDate: text(10),
  targetAmount: text(32),
  // The user refers to the transaction the assistant just saved ("make that $12").
  targetLastSaved: z.boolean(),
  // Further requests in the same message, handled one at a time after this one.
  deferred: text(300),
  clarification: text(300),
}).strict();
export type TransactionIntent = z.infer<typeof TransactionIntentSchema>;

export const EMPTY_TRANSACTION_INTENT: TransactionIntent = {
  operation: "CLARIFY", amount: null, direction: null, accountQuery: null, accountCandidates: [],
  bankQuery: null, subject: null, date: null, currency: null, targetQuery: null,
  targetDate: null, targetAmount: null, targetLastSaved: false, deferred: null, clarification: null,
};

export const AGENT_EDIT_FIELDS = ["amount", "subject", "date", "direction", "budget"] as const;
export type AgentEditField = typeof AGENT_EDIT_FIELDS[number];

export const AgentSelectionSchema = z.object({
  kind: z.enum(["budget", "transaction"]), id: z.string().min(1).max(191),
}).strict();
const id = z.string().min(1).max(191);
const reference = { draftId: id, revision: z.number().int().nonnegative() };
const message = z.string().trim().min(1).max(600);
export const TransactionAgentRequestSchema = z.discriminatedUnion("action", [
  // previousDraftId lets "make that $12" refer to the transaction saved by the previous draft.
  z.object({ action: z.literal("start"), message, previousDraftId: id.optional() }).strict(),
  z.object({ action: z.literal("message"), ...reference, message }).strict(),
  z.object({ action: z.literal("select"), ...reference, selection: AgentSelectionSchema }).strict(),
  // Deterministic field edits from the review card. No model call; the server re-validates everything.
  z.object({ action: z.literal("edit"), ...reference, field: z.enum(AGENT_EDIT_FIELDS), value: z.string().trim().max(120).optional() }).strict(),
  z.object({ action: z.literal("confirm"), ...reference }).strict(),
  z.object({ action: z.literal("cancel"), ...reference }).strict(),
]);
export type TransactionAgentRequest = z.infer<typeof TransactionAgentRequestSchema>;
export type AgentChoice = z.infer<typeof AgentSelectionSchema> & { label: string; detail: string; suggested?: boolean };
export type AgentBudget = { id: string; accountId: string; name: string; accountName: string; availableCents: number };
export type AgentTransaction = {
  id: string; accountId: string; budgetId: string | null; subject: string;
  amountCents: number; direction: "DEBIT" | "CREDIT"; kind: string; date: string;
  updatedAt: string; groupId: string | null; details: string | null; notes: string | null;
};
export type AgentReview = {
  operation: "CREATE" | "UPDATE";
  currency: string;
  before: AgentTransaction | null;
  after: {
    accountId: string; budgetId: string; subject: string; amountCents: number;
    direction: "DEBIT" | "CREDIT"; kind: "EXPENSE" | "INCOME" | "ADJUSTMENT"; date: string;
  };
  balances: Array<AgentBudget & { afterCents: number }>;
  warnings: string[];
};
/** The one detail the assistant is waiting for, so short replies ("bus fare", "12") need no model call. */
export type AgentPending = "budget" | "amount" | "direction" | "subject" | "date" | "target" | null;
export type AgentLastSaved = { transactionId: string; subject: string; amountCents: number; direction: "DEBIT" | "CREDIT"; budgetName: string | null; date: string };
export type AgentState = {
  intent: TransactionIntent;
  budgetId: string | null;
  transactionId: string | null;
  message: string;
  choices: AgentChoice[];
  review: AgentReview | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  pending?: AgentPending;
  /** The user asked to choose a different sub-account, so do not keep the original one. */
  pickBudget?: boolean;
  lastSaved?: AgentLastSaved | null;
  savedTransactionId?: string;
};
export type TransactionAgentView = {
  draftId: string; revision: number;
  status: "CLARIFY" | "REVIEW" | "SAVED" | "CANCELLED" | "EXPIRED";
  expiresAt: string; message: string; choices: AgentChoice[];
  review: AgentReview | null;
  messages: AgentState["messages"];
  pending: AgentPending;
  savedTransactionId?: string;
  /** A request the user made in the same message, offered as the next step after saving. */
  nextRequest?: string | null;
};

export { couldBeTransaction, isTransactionRequest } from "./transaction-request";
