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

const ACTION_VERBS = String.raw`deduct|subtract|minus|spent|spend|paid|pay|bought|buy|deposit|withdrew|withdraw|refund(?:ed)?|record|log|received|receive|got paid|top(?:ped)? up|credit|debit|charge[ds]?|took|take \S+ (?:out|off)|minus`;
const EDIT_VERBS = `add(?:ed)?|got|create|move|transfer|delete|remove|undo|void|update|edit|change|correct|fix|rename|make (?:it|that)|put`;
const QUESTION_WORDS = new Set([
  "how", "what", "why", "when", "where", "which", "who", "whose", "did", "do", "does",
  "have", "has", "is", "are", "was", "were", "am", "should", "shall", "will", "would",
  "compare", "show", "list", "summarise", "summarize", "explain", "find",
]);
const POLITE_REQUEST = /^\s*(?:(?:can|could|would|will) you|please|pls|help me|i (?:want|need|would like) to|i'd like to|let's|lets)\b/i;

function startsWithQuestion(text: string) {
  const word = /^[a-z]+\b/i.exec(text);
  if (word && QUESTION_WORDS.has(word[0].toLowerCase())) return true;
  return /^(?:tell|give) me\b/i.test(text);
}

/** Only routes Ask Nest input to the drafting UI. It never authorizes a write. */
export function isTransactionRequest(message: string) {
  const text = message.trim();
  if (!text) return false;
  const imperative = new RegExp(String.raw`\b(?:${ACTION_VERBS})\b`, "i").test(text)
    || new RegExp(String.raw`\b(?:${EDIT_VERBS})\b.*(?:\$|\d|transaction|expense|income|payment|entry|salary|allowance|bonus|refund|fare|bill)`, "i").test(text);
  if (!imperative) return false;
  // "Can you add $10…" is a request; "How much did I spend?" and "Did I pay…?" are questions.
  if (POLITE_REQUEST.test(text)) return true;
  if (startsWithQuestion(text)) return false;
  return !/\?\s*$/.test(text) || /\b(?:deduct|record|log)\b/i.test(text);
}

/** Offers "Record this instead" under an answer: the message states an amount and does not read as a question. */
export function couldBeTransaction(message: string) {
  const text = message.trim();
  const hasAmount = /(?:\$|\b(?:sgd|usd|s\$))\s*\d/i.test(text)
    || /\b\d+(?:\.\d{1,2})?\s*(?:dollars|bucks|sgd)\b/i.test(text);
  return hasAmount && !startsWithQuestion(text) && !/\?\s*$/.test(text);
}
