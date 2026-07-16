import type { Prisma } from "@prisma/client";
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import type { AskNestEvidence } from "@/lib/ai/ask-nest-types";
import {
  buildAskNestSearchTerms,
  canonicalizeMerchant,
  resolveAskNestAccount,
  resolveAskNestBudget,
  resolveAskNestCard,
  type AskNestEntityResolution,
} from "@/lib/ai/entity-resolution";
import { searchAskNestKnowledge } from "@/lib/ai/knowledge-search";
import {
  classifyTransactionCategory,
  TRANSACTION_CATEGORY_LABELS,
} from "@/lib/ai/transaction-categories.mjs";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 731;

const NullableDateSchema = z.string().regex(ISO_DATE_PATTERN).nullable();
const NullableNameSchema = z.string().trim().min(1).max(120).nullable();

const SnapshotArgsSchema = z.object({
  start_date: NullableDateSchema,
  end_date: NullableDateSchema,
}).strict();

const CompareSpendingArgsSchema = z.object({
  period_a_start: z.string().regex(ISO_DATE_PATTERN),
  period_a_end: z.string().regex(ISO_DATE_PATTERN),
  period_b_start: z.string().regex(ISO_DATE_PATTERN),
  period_b_end: z.string().regex(ISO_DATE_PATTERN),
  account_name: NullableNameSchema,
  budget_name: NullableNameSchema,
}).strict();

const CATEGORY_SPENDING_KEYS = [
  "ALL",
  "TRANSPORT",
  "DINING",
  "GROCERIES",
  "UTILITIES",
  "HOUSING",
  "SHOPPING",
  "ENTERTAINMENT",
  "HEALTHCARE",
  "EDUCATION",
  "TRAVEL",
  "INSURANCE",
  "PERSONAL_CARE",
  "CHILDCARE",
  "PETS",
  "FEES",
  "TAXES",
  "GIFTS_CHARITY",
] as const;

const CategorySpendingArgsSchema = z.object({
  category: z.enum(CATEGORY_SPENDING_KEYS),
  period_a_start: z.string().regex(ISO_DATE_PATTERN),
  period_a_end: z.string().regex(ISO_DATE_PATTERN),
  period_b_start: NullableDateSchema,
  period_b_end: NullableDateSchema,
  account_name: NullableNameSchema,
  limit: z.number().int().min(1).max(20),
}).strict();

const FindTransactionsArgsSchema = z.object({
  query: z.string().trim().max(120).nullable(),
  start_date: NullableDateSchema,
  end_date: NullableDateSchema,
  account_name: NullableNameSchema,
  budget_name: NullableNameSchema,
  limit: z.number().int().min(1).max(50),
}).strict();

const FindCardTransactionsArgsSchema = z.object({
  query: z.string().trim().max(120).nullable(),
  start_date: NullableDateSchema,
  end_date: NullableDateSchema,
  card_name: NullableNameSchema,
  allocation_status: z.enum(["ANY", "ALLOCATED", "UNALLOCATED"]),
  limit: z.number().int().min(1).max(50),
}).strict();

const CardObligationsArgsSchema = z.object({
  before_date: NullableDateSchema,
}).strict();

const ReceivablesArgsSchema = z.object({
  status: z.enum(["ANY", "OPEN", "PARTIAL", "PAID", "VOID"]),
  through_date: NullableDateSchema,
  limit: z.number().int().min(1).max(50),
}).strict();

const BudgetPlanArgsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
}).strict();

const ReconciliationArgsSchema = z.object({
  account_name: NullableNameSchema,
}).strict();

const SpendingBreakdownArgsSchema = z.object({
  start_date: z.string().regex(ISO_DATE_PATTERN),
  end_date: z.string().regex(ISO_DATE_PATTERN),
  granularity: z.enum(["MONTH", "YEAR"]),
  account_name: NullableNameSchema,
  budget_name: NullableNameSchema,
}).strict();

const InvestmentSummaryArgsSchema = z.object({
  account_name: NullableNameSchema,
  as_of_date: NullableDateSchema,
}).strict();

const TripSpendingArgsSchema = z.object({
  start_date: z.string().regex(ISO_DATE_PATTERN),
  end_date: z.string().regex(ISO_DATE_PATTERN),
  query: z.string().trim().min(1).max(120).nullable(),
  destination_hints: z.array(z.string().trim().min(1).max(80)).max(12),
}).strict();

const ExplainCashFlowChangeArgsSchema = z.object({
  period_a_start: z.string().regex(ISO_DATE_PATTERN),
  period_a_end: z.string().regex(ISO_DATE_PATTERN),
  period_b_start: z.string().regex(ISO_DATE_PATTERN),
  period_b_end: z.string().regex(ISO_DATE_PATTERN),
  account_name: NullableNameSchema,
}).strict();

const CompareIncomeArgsSchema = z.object({
  period_a_start: z.string().regex(ISO_DATE_PATTERN),
  period_a_end: z.string().regex(ISO_DATE_PATTERN),
  period_b_start: z.string().regex(ISO_DATE_PATTERN),
  period_b_end: z.string().regex(ISO_DATE_PATTERN),
  account_name: NullableNameSchema,
}).strict();

const TopSpendingDriversArgsSchema = z.object({
  start_date: z.string().regex(ISO_DATE_PATTERN),
  end_date: z.string().regex(ISO_DATE_PATTERN),
  dimension: z.enum(["SUB_ACCOUNT", "MERCHANT"]),
  account_name: NullableNameSchema,
  budget_name: NullableNameSchema,
  limit: z.number().int().min(1).max(20),
}).strict();

const BudgetVsActualArgsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  budget_name: NullableNameSchema,
}).strict();

const RecurringSpendArgsSchema = z.object({
  start_date: z.string().regex(ISO_DATE_PATTERN),
  end_date: z.string().regex(ISO_DATE_PATTERN),
  account_name: NullableNameSchema,
  budget_name: NullableNameSchema,
  min_occurrences: z.number().int().min(2).max(24),
  limit: z.number().int().min(1).max(20),
}).strict();

const SearchWorkspaceKnowledgeArgsSchema = z.object({
  query: z.string().trim().min(2).max(300),
  limit: z.number().int().min(1).max(8),
}).strict();

type DateRange = {
  start: Date;
  endExclusive: Date;
  startLabel: string;
  endLabel: string;
};

type CardObligation = {
  cardName: string;
  bankName: string | null;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: string;
  outstandingCents: number;
  outstanding: string;
};

export type AskNestToolContext = {
  workspaceId: string;
  userId: string;
  currency: string;
  callId: string;
};

export type AskNestToolResult = {
  output: Record<string, unknown>;
  evidence: AskNestEvidence[];
};

export class AskNestToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskNestToolInputError";
  }
}

const nullableString = { type: ["string", "null"] } as const;

export const ASK_NEST_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "get_financial_snapshot",
    description: "Get a high-level workspace snapshot for a date range, including cash flow, bank reconciliation, budgets, open receivables, and card obligations. Use this for broad status questions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        start_date: { ...nullableString, description: "Inclusive YYYY-MM-DD date, or null for the first day of the current month." },
        end_date: { ...nullableString, description: "Inclusive YYYY-MM-DD date, or null for today." },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    type: "function",
    name: "compare_spending",
    description: "Compare debit spending between two explicit date ranges, with optional account or budget name filters. All totals and changes are calculated by Nest.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        period_a_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the newer or primary period." },
        period_a_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the newer or primary period." },
        period_b_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the comparison period." },
        period_b_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the comparison period." },
        account_name: { ...nullableString, description: "Optional account or bank name fragment, otherwise null." },
        budget_name: { ...nullableString, description: "Optional budget/sub-account name fragment, otherwise null." },
      },
      required: ["period_a_start", "period_a_end", "period_b_start", "period_b_end", "account_name", "budget_name"],
    },
  },
  {
    type: "function",
    name: "get_category_spending",
    description: "Calculate debit spending by deterministic real-world transaction category, independent of the sub-account holding the transaction. Supports one period, an optional comparison period, and an ALL-category breakdown. Confirmed totals include high-confidence merchant, description, or explicitly named sub-account matches; ambiguous multi-service merchants are returned separately as possible spending.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        category: {
          type: "string",
          enum: CATEGORY_SPENDING_KEYS,
          description: "Use ALL for a semantic category breakdown; otherwise select the requested category. DINING includes restaurants and food delivery, while GROCERIES is supermarket and grocery delivery spending.",
        },
        period_a_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the primary period." },
        period_a_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the primary period." },
        period_b_start: { ...nullableString, description: "Inclusive comparison start, or null when no comparison was requested." },
        period_b_end: { ...nullableString, description: "Inclusive comparison end, or null when no comparison was requested." },
        account_name: { ...nullableString, description: "Optional account or bank name, otherwise null. Do not put a sub-account name here." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum category or merchant rows to return." },
      },
      required: ["category", "period_a_start", "period_a_end", "period_b_start", "period_b_end", "account_name", "limit"],
    },
  },
  {
    type: "function",
    name: "find_transactions",
    description: "Find visible, non-reversed ledger transactions using bounded text, date, account, and budget filters. Use this to support questions about particular merchants or entries.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { ...nullableString, description: "Subject/details text to search, or null." },
        start_date: { ...nullableString, description: "Inclusive YYYY-MM-DD start, or null for 90 days ago." },
        end_date: { ...nullableString, description: "Inclusive YYYY-MM-DD end, or null for today." },
        account_name: { ...nullableString, description: "Optional account or bank name fragment, otherwise null." },
        budget_name: { ...nullableString, description: "Optional budget/sub-account name fragment, otherwise null." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum rows to return." },
      },
      required: ["query", "start_date", "end_date", "account_name", "budget_name", "limit"],
    },
  },
  {
    type: "function",
    name: "get_card_obligations",
    description: "Get outstanding credit-card statement balances and payment due dates, optionally limited to a date.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        before_date: { ...nullableString, description: "Return obligations due on or before this YYYY-MM-DD date, or null for all outstanding statements." },
      },
      required: ["before_date"],
    },
  },
  {
    type: "function",
    name: "find_card_transactions",
    description: "Find credit-card activity by merchant text, date, card name, and allocation status. Use this for unallocated card activity that is not yet in the ledger.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { ...nullableString, description: "Merchant or subject text, or null." },
        start_date: { ...nullableString, description: "Inclusive YYYY-MM-DD start, or null for 90 days ago." },
        end_date: { ...nullableString, description: "Inclusive YYYY-MM-DD end, or null for today." },
        card_name: { ...nullableString, description: "Optional card or bank name fragment, otherwise null." },
        allocation_status: { type: "string", enum: ["ANY", "ALLOCATED", "UNALLOCATED"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query", "start_date", "end_date", "card_name", "allocation_status", "limit"],
    },
  },
  {
    type: "function",
    name: "get_receivables",
    description: "List workspace receivables by status and record date. This does not infer a contractual due date.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["ANY", "OPEN", "PARTIAL", "PAID", "VOID"] },
        through_date: { ...nullableString, description: "Include records dated on or before YYYY-MM-DD, or null." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["status", "through_date", "limit"],
    },
  },
  {
    type: "function",
    name: "get_budget_plan",
    description: "Get the deterministic monthly budget plan, sources, allocations, and remaining amount for one month.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        year: { type: "integer", minimum: 2000, maximum: 2100 },
        month: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["year", "month"],
    },
  },
  {
    type: "function",
    name: "explain_reconciliation",
    description: "Get configured bank balances, linked sub-account totals, and exact reconciliation discrepancies. Use this for questions about mismatched balances.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        account_name: { ...nullableString, description: "Optional bank account name fragment, otherwise null for every bank account." },
      },
      required: ["account_name"],
    },
  },
  {
    type: "function",
    name: "get_spending_breakdown",
    description: "Group debit spending by sub-account and calendar month or year for one bounded date range. Use this for monthly, annual, trend, grouped, or sub-account breakdown questions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        start_date: { type: "string", description: "Inclusive YYYY-MM-DD start date." },
        end_date: { type: "string", description: "Inclusive YYYY-MM-DD end date." },
        granularity: { type: "string", enum: ["MONTH", "YEAR"], description: "Calendar buckets to return." },
        account_name: { ...nullableString, description: "Optional bank account name fragment, otherwise null." },
        budget_name: { ...nullableString, description: "Optional sub-account name fragment, otherwise null." },
      },
      required: ["start_date", "end_date", "granularity", "account_name", "budget_name"],
    },
  },
  {
    type: "function",
    name: "get_investment_summary",
    description: "Get recorded investment account values and portfolio totals as of a date. This reports Nest data only and does not provide investment advice or market data.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        account_name: { ...nullableString, description: "Optional account, product, or institution name fragment, otherwise null." },
        as_of_date: { ...nullableString, description: "Latest entry on or before YYYY-MM-DD, or null for today." },
      },
      required: ["account_name", "as_of_date"],
    },
  },
  {
    type: "function",
    name: "get_trip_spending",
    description: "Summarize recorded transaction groups that represent trips, holidays, vacations, or travel, including destination-style names and exact debit spending per group. Use this for where-did-I-travel and how-much-per-trip follow-ups.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        start_date: { type: "string", description: "Inclusive YYYY-MM-DD start date." },
        end_date: { type: "string", description: "Inclusive YYYY-MM-DD end date." },
        query: { ...nullableString, description: "Optional trip or destination name fragment, otherwise null." },
        destination_hints: {
          type: "array",
          maxItems: 12,
          items: { type: "string", maxLength: 80 },
          description: "Destination names copied from the question or a prior grounded answer. Use an empty array when none are available.",
        },
      },
      required: ["start_date", "end_date", "query", "destination_hints"],
    },
  },
  {
    type: "function",
    name: "explain_cash_flow_change",
    description: "Explain why net cash flow changed between two explicit periods. Nest calculates income, spending, net change, and the largest recorded merchant or sub-account drivers. Use this for why-is-cash-flow-higher-or-lower questions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        period_a_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the newer or primary period." },
        period_a_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the newer or primary period." },
        period_b_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the comparison period." },
        period_b_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the comparison period." },
        account_name: { ...nullableString, description: "Optional account or bank name, including common abbreviations, otherwise null." },
      },
      required: ["period_a_start", "period_a_end", "period_b_start", "period_b_end", "account_name"],
    },
  },
  {
    type: "function",
    name: "compare_income",
    description: "Compare recorded credit inflows between two explicit periods and return deterministic changes and top income sources. Use for salary, earnings, income, or inflow comparisons.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        period_a_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the newer or primary period." },
        period_a_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the newer or primary period." },
        period_b_start: { type: "string", description: "Inclusive YYYY-MM-DD start for the comparison period." },
        period_b_end: { type: "string", description: "Inclusive YYYY-MM-DD end for the comparison period." },
        account_name: { ...nullableString, description: "Optional account or bank name, otherwise null." },
      },
      required: ["period_a_start", "period_a_end", "period_b_start", "period_b_end", "account_name"],
    },
  },
  {
    type: "function",
    name: "get_top_spending_drivers",
    description: "Rank the largest recorded debit-spending drivers by sub-account or normalized merchant for a bounded date range. Use for where-did-my-money-go and biggest-expense questions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        start_date: { type: "string", description: "Inclusive YYYY-MM-DD start date." },
        end_date: { type: "string", description: "Inclusive YYYY-MM-DD end date." },
        dimension: { type: "string", enum: ["SUB_ACCOUNT", "MERCHANT"] },
        account_name: { ...nullableString, description: "Optional account or bank name, otherwise null." },
        budget_name: { ...nullableString, description: "Optional sub-account or category concept such as food, transport, or utilities, otherwise null." },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["start_date", "end_date", "dimension", "account_name", "budget_name", "limit"],
    },
  },
  {
    type: "function",
    name: "get_budget_vs_actual",
    description: "Compare one monthly budget plan with actual recorded debit spending by destination sub-account. Use for planned-versus-spent, utilization, and budget variance questions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        year: { type: "integer", minimum: 2000, maximum: 2100 },
        month: { type: "integer", minimum: 1, maximum: 12 },
        budget_name: { ...nullableString, description: "Optional sub-account or category concept, otherwise null." },
      },
      required: ["year", "month", "budget_name"],
    },
  },
  {
    type: "function",
    name: "find_recurring_spend",
    description: "Detect repeated recorded debit merchants with weekly, fortnightly, monthly, quarterly, or annual cadence inside a bounded range. Results are patterns in Nest data, not confirmed subscriptions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        start_date: { type: "string", description: "Inclusive YYYY-MM-DD start date." },
        end_date: { type: "string", description: "Inclusive YYYY-MM-DD end date." },
        account_name: { ...nullableString, description: "Optional account or bank name, otherwise null." },
        budget_name: { ...nullableString, description: "Optional sub-account or category concept, otherwise null." },
        min_occurrences: { type: "integer", minimum: 2, maximum: 24 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["start_date", "end_date", "account_name", "budget_name", "min_occurrences", "limit"],
    },
  },
];

export const ASK_NEST_KNOWLEDGE_TOOL: FunctionTool = {
  type: "function",
  name: "search_workspace_knowledge",
  description: "Hybrid keyword and vector search over user-authorized workspace notes and imported document passages. Use only for unstructured content questions; never use passages as the source for calculated ledger totals.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", minLength: 2, maxLength: 300, description: "Plain-language passage search query." },
      limit: { type: "integer", minimum: 1, maximum: 8 },
    },
    required: ["query", "limit"],
  },
};

export function getAskNestTools(includeKnowledgeSearch: boolean) {
  return includeKnowledgeSearch ? [...ASK_NEST_TOOLS, ASK_NEST_KNOWLEDGE_TOOL] : ASK_NEST_TOOLS;
}

function getTodayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseIsoDate(value: string, label: string) {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new AskNestToolInputError(`${label} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AskNestToolInputError(`${label} is not a valid calendar date.`);
  }
  return date;
}

function resolveRange(startValue: string, endValue: string): DateRange {
  const start = parseIsoDate(startValue, "Start date");
  const end = parseIsoDate(endValue, "End date");
  if (start > end) {
    throw new AskNestToolInputError("Start date must be on or before end date.");
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new AskNestToolInputError("Date ranges are limited to two years.");
  }
  return {
    start,
    endExclusive: addUtcDays(end, 1),
    startLabel: startValue,
    endLabel: endValue,
  };
}

function currentMonthRange(startValue: string | null, endValue: string | null) {
  const today = getTodayIso();
  return resolveRange(startValue ?? `${today.slice(0, 7)}-01`, endValue ?? today);
}

function recentRange(startValue: string | null, endValue: string | null) {
  const today = getTodayIso();
  const defaultStart = addUtcDays(parseIsoDate(today, "Today"), -89).toISOString().slice(0, 10);
  return resolveRange(startValue ?? defaultStart, endValue ?? today);
}

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100).replace(/\u00a0/g, " ");
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

type ResolvedTransactionFilters = {
  accountName: string | null;
  budgetName: string | null;
  accountIds?: string[];
  budgetIds?: string[];
  resolutions: AskNestEntityResolution[];
};

async function resolveTransactionFilters(
  workspaceId: string,
  accountName: string | null,
  budgetName: string | null,
): Promise<ResolvedTransactionFilters> {
  const [account, budget] = await Promise.all([
    resolveAskNestAccount(workspaceId, accountName),
    resolveAskNestBudget(workspaceId, budgetName),
  ]);
  return {
    accountName,
    budgetName,
    ...(account?.matched ? { accountIds: account.ids } : {}),
    ...(budget?.matched ? { budgetIds: budget.ids } : {}),
    resolutions: [account, budget].filter((item): item is AskNestEntityResolution => Boolean(item)),
  };
}

function resolvedFilterOutput(filters: ResolvedTransactionFilters) {
  return {
    accountName: filters.accountName,
    budgetName: filters.budgetName,
    entityResolution: filters.resolutions.map((resolution) => ({
      kind: resolution.kind,
      input: resolution.input,
      matched: resolution.matched,
      labels: resolution.labels,
      confidence: resolution.confidence,
      method: resolution.method,
    })),
  };
}

function transactionWhere(
  workspaceId: string,
  range: DateRange,
  filters?: ResolvedTransactionFilters,
): Prisma.TransactionWhereInput {
  return {
    workspaceId,
    voidedAt: null,
    kind: { not: "REVERSAL" },
    date: { gte: range.start, lt: range.endExclusive },
    ...(filters?.accountIds?.length
      ? { accountId: { in: filters.accountIds } }
      : filters?.accountName
      ? {
          account: {
            workspaceId,
            OR: [
              { name: { contains: filters.accountName } },
              { bankName: { contains: filters.accountName } },
            ],
          },
        }
      : {}),
    ...(filters?.budgetIds?.length
      ? { budgetId: { in: filters.budgetIds } }
      : filters?.budgetName
      ? { budget: { workspaceId, name: { contains: filters.budgetName } } }
      : {}),
  };
}

function transactionTextWhere(query: string): Prisma.TransactionWhereInput {
  const terms = buildAskNestSearchTerms(query);
  const phrase = query.trim();
  const tokens = terms.filter((term) => !term.includes(" ") && term.toLocaleLowerCase() !== phrase.toLocaleLowerCase());
  const fieldMatch = (value: string): Prisma.TransactionWhereInput => ({
    OR: [
      { subject: { contains: value } },
      { details: { contains: value } },
      { notes: { contains: value } },
    ],
  });
  return {
    OR: [
      fieldMatch(phrase),
      ...(tokens.length > 1 ? [{ AND: tokens.map(fieldMatch) }] : []),
    ],
  };
}

function evidence(
  callId: string,
  suffix: string,
  label: string,
  detail: string,
  href: string,
): AskNestEvidence {
  return { id: `${callId}:${suffix}`, label, detail, href };
}

function transactionHref(filters: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  params.set("view", "ask-nest");
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

type TransactionEvidenceSource = {
  id: string;
  accountId: string;
  budgetId: string | null;
  date: Date;
  subject: string;
  amountCents: number;
  budget?: { workspaceId: string; name: string } | null;
  subAccount?: string;
};

function transactionRecordEvidence(params: {
  context: AskNestToolContext;
  rows: TransactionEvidenceSource[];
  suffix: string;
  limit?: number;
}) {
  return params.rows.slice(0, params.limit ?? 8).map((row) => {
    const subAccount = row.subAccount ?? (
      row.budget?.workspaceId === params.context.workspaceId ? row.budget.name : "Unassigned"
    );
    return evidence(
      params.context.callId,
      `${params.suffix}-${row.id}`,
      `${row.subject} · ${formatAmount(row.amountCents, params.context.currency)}`,
      `${formatDate(row.date)} · ${subAccount}`,
      transactionHref({
        accountId: row.accountId,
        budgetId: row.budgetId,
        transactionId: row.id,
      }),
    );
  });
}

async function loadTransactionRecordEvidence(params: {
  context: AskNestToolContext;
  where: Prisma.TransactionWhereInput;
  suffix: string;
  limit?: number;
  orderBy?: Prisma.TransactionOrderByWithRelationInput[];
}) {
  const rows = await prisma.transaction.findMany({
    where: { ...params.where, workspaceId: params.context.workspaceId },
    orderBy: params.orderBy ?? [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: params.limit ?? 8,
    select: {
      id: true,
      accountId: true,
      budgetId: true,
      date: true,
      subject: true,
      amountCents: true,
      budget: { select: { workspaceId: true, name: true } },
    },
  });
  return transactionRecordEvidence({
    context: params.context,
    rows,
    suffix: params.suffix,
    limit: params.limit,
  });
}

const COUNTRY_FLAGS = [
  ["singapore", "🇸🇬"], ["malaysia", "🇲🇾"], ["japan", "🇯🇵"], ["korea", "🇰🇷"],
  ["south korea", "🇰🇷"], ["china", "🇨🇳"], ["hong kong", "🇭🇰"], ["taiwan", "🇹🇼"],
  ["thailand", "🇹🇭"], ["vietnam", "🇻🇳"], ["indonesia", "🇮🇩"], ["philippines", "🇵🇭"],
  ["australia", "🇦🇺"], ["new zealand", "🇳🇿"], ["india", "🇮🇳"], ["sri lanka", "🇱🇰"],
  ["united kingdom", "🇬🇧"], ["uk", "🇬🇧"], ["england", "🇬🇧"], ["france", "🇫🇷"],
  ["germany", "🇩🇪"], ["italy", "🇮🇹"], ["spain", "🇪🇸"], ["portugal", "🇵🇹"],
  ["switzerland", "🇨🇭"], ["netherlands", "🇳🇱"], ["greece", "🇬🇷"], ["turkey", "🇹🇷"],
  ["united states", "🇺🇸"], ["usa", "🇺🇸"], ["canada", "🇨🇦"], ["mexico", "🇲🇽"],
  ["dubai", "🇦🇪"], ["uae", "🇦🇪"], ["maldives", "🇲🇻"], ["bali", "🇮🇩"],
  ["tokyo", "🇯🇵"], ["osaka", "🇯🇵"], ["kyoto", "🇯🇵"], ["fukuoka", "🇯🇵"],
  ["seoul", "🇰🇷"], ["busan", "🇰🇷"], ["bangkok", "🇹🇭"], ["phuket", "🇹🇭"],
  ["kuala lumpur", "🇲🇾"], ["penang", "🇲🇾"], ["taipei", "🇹🇼"],
  ["sydney", "🇦🇺"], ["melbourne", "🇦🇺"], ["perth", "🇦🇺"], ["auckland", "🇳🇿"],
  ["london", "🇬🇧"], ["paris", "🇫🇷"], ["rome", "🇮🇹"], ["milan", "🇮🇹"],
  ["barcelona", "🇪🇸"], ["madrid", "🇪🇸"], ["amsterdam", "🇳🇱"], ["zurich", "🇨🇭"],
  ["new york", "🇺🇸"], ["los angeles", "🇺🇸"], ["san francisco", "🇺🇸"], ["hawaii", "🇺🇸"],
  ["vancouver", "🇨🇦"], ["toronto", "🇨🇦"], ["hanoi", "🇻🇳"], ["ho chi minh", "🇻🇳"],
  ["manila", "🇵🇭"], ["cebu", "🇵🇭"], ["jakarta", "🇮🇩"], ["shanghai", "🇨🇳"], ["beijing", "🇨🇳"],
] as const;

function findDestination(value: string) {
  const normalized = value.toLocaleLowerCase();
  return COUNTRY_FLAGS.find(([country]) => (
    country.length <= 3
      ? new RegExp(`\\b${country}\\b`, "i").test(normalized)
      : normalized.includes(country)
  ));
}

function getDestinationFlag(value: string, icon: string | null) {
  if (icon && /^\p{Regional_Indicator}{2}$/u.test(icon)) return icon;
  return findDestination(value)?.[1] ?? "🧳";
}

function formatDestinationLabel(value: string) {
  const trimmed = value.trim();
  if (/^(uk|usa|uae)$/i.test(trimmed)) return trimmed.toLocaleUpperCase();
  return trimmed.replace(/\b\w/g, (character) => character.toLocaleUpperCase());
}

async function loadCardObligations(
  workspaceId: string,
  currency: string,
  beforeDate: string | null,
): Promise<CardObligation[]> {
  const grouped = await prisma.creditCardTransaction.groupBy({
    by: ["creditCardId", "statementMonth", "statementYear"],
    where: { workspaceId },
    _sum: { amountCents: true },
    _min: { paymentDueDate: true },
  });
  const cardIds = [...new Set(grouped.map((row) => row.creditCardId))];
  const cards = cardIds.length
    ? await prisma.creditCardAccount.findMany({
        where: { workspaceId, id: { in: cardIds } },
        select: { id: true, cardName: true, bankName: true },
      })
    : [];
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const through = beforeDate ? addUtcDays(parseIsoDate(beforeDate, "Before date"), 1) : null;

  return grouped
    .map((row) => {
      const outstandingCents = row._sum.amountCents ?? 0;
      const dueDate = row._min.paymentDueDate;
      const card = cardById.get(row.creditCardId);
      if (!card || !dueDate || outstandingCents <= 0 || (through && dueDate >= through)) return null;
      return {
        cardName: card.cardName,
        bankName: card.bankName,
        statementMonth: row.statementMonth,
        statementYear: row.statementYear,
        paymentDueDate: formatDate(dueDate),
        outstandingCents,
        outstanding: formatAmount(outstandingCents, currency),
      } satisfies CardObligation;
    })
    .filter((row): row is CardObligation => Boolean(row))
    .sort((a, b) => a.paymentDueDate.localeCompare(b.paymentDueDate));
}

async function getFinancialSnapshot(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = SnapshotArgsSchema.parse(rawArgs);
  const range = currentMonthRange(args.start_date, args.end_date);
  const where = transactionWhere(context.workspaceId, range);
  const [workspace, transactionSummary, bankRows, budgets, receivableSummary, receivableCount, obligations] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: context.workspaceId },
      select: { name: true },
    }),
    prisma.transaction.groupBy({
      by: ["direction"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    getBankConsistency(prisma, context.workspaceId),
    prisma.budgetEnvelope.findMany({
      where: { workspaceId: context.workspaceId, isActive: true },
      orderBy: [{ availableCents: "asc" }, { name: "asc" }],
      take: 30,
      select: { name: true, targetCents: true, availableCents: true, account: { select: { name: true } } },
    }),
    prisma.receivable.aggregate({
      where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "PARTIAL"] } },
      _sum: { amountCents: true },
    }),
    prisma.receivable.count({
      where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "PARTIAL"] } },
    }),
    loadCardObligations(context.workspaceId, context.currency, null),
  ]);
  const inflowCents = transactionSummary.find((row) => row.direction === "CREDIT")?._sum.amountCents ?? 0;
  const outflowCents = transactionSummary.find((row) => row.direction === "DEBIT")?._sum.amountCents ?? 0;
  const transactionCount = transactionSummary.reduce((sum, row) => sum + row._count._all, 0);
  const openReceivableCents = receivableSummary._sum.amountCents ?? 0;
  const totalCardOutstandingCents = obligations.reduce((sum, item) => sum + item.outstandingCents, 0);
  const snapshotEvidence = evidence(
    context.callId,
    "snapshot",
    "Financial snapshot",
    `${range.startLabel} to ${range.endLabel} · ${transactionCount} ledger transactions`,
    "/",
  );

  return {
    output: {
      ok: true,
      evidence: [snapshotEvidence],
      workspace: workspace?.name ?? "Current workspace",
      currency: context.currency,
      period: { start: range.startLabel, end: range.endLabel },
      cashFlow: {
        inflowCents,
        inflow: formatAmount(inflowCents, context.currency),
        outflowCents,
        outflow: formatAmount(outflowCents, context.currency),
        netCents: inflowCents - outflowCents,
        net: formatAmount(inflowCents - outflowCents, context.currency),
        transactionCount,
      },
      bankReconciliation: bankRows.map((row) => ({
        name: row.name,
        configuredBalance: formatAmount(row.currentBalanceCents, context.currency),
        linkedSubAccountTotal: formatAmount(row.linkedBudgetTotalCents, context.currency),
        discrepancy: formatAmount(row.discrepancyCents, context.currency),
        reconciled: row.discrepancyCents === 0,
      })),
      budgets: budgets.map((budget) => ({
        name: budget.name,
        bankAccount: budget.account.name,
        target: formatAmount(budget.targetCents, context.currency),
        available: formatAmount(budget.availableCents, context.currency),
      })),
      openReceivables: {
        count: receivableCount,
        totalCents: openReceivableCents,
        total: formatAmount(openReceivableCents, context.currency),
      },
      cardObligations: {
        count: obligations.length,
        totalCents: totalCardOutstandingCents,
        total: formatAmount(totalCardOutstandingCents, context.currency),
        next: obligations.slice(0, 8),
      },
    },
    evidence: [snapshotEvidence],
  };
}

async function summarizeSpendingPeriod(
  context: AskNestToolContext,
  range: DateRange,
  filters: ResolvedTransactionFilters,
) {
  const where: Prisma.TransactionWhereInput = {
    ...transactionWhere(context.workspaceId, range, filters),
    direction: "DEBIT",
  };
  const rows = await prisma.transaction.groupBy({
    by: ["budgetId"],
    where,
    _sum: { amountCents: true },
    _count: { _all: true },
  });
  const budgetIds = rows.map((row) => row.budgetId).filter((id): id is string => Boolean(id));
  const budgets = budgetIds.length
    ? await prisma.budgetEnvelope.findMany({
        where: { workspaceId: context.workspaceId, id: { in: budgetIds } },
        select: { id: true, name: true },
      })
    : [];
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget.name]));
  const totalCents = rows.reduce((sum, row) => sum + (row._sum.amountCents ?? 0), 0);
  const count = rows.reduce((sum, row) => sum + row._count._all, 0);
  return {
    start: range.startLabel,
    end: range.endLabel,
    totalCents,
    total: formatAmount(totalCents, context.currency),
    transactionCount: count,
    byBudget: rows
      .map((row) => ({
        name: row.budgetId ? budgetById.get(row.budgetId) ?? "Unknown budget" : "Unassigned",
        amountCents: row._sum.amountCents ?? 0,
        amount: formatAmount(row._sum.amountCents ?? 0, context.currency),
        transactionCount: row._count._all,
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
  };
}

async function compareSpending(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = CompareSpendingArgsSchema.parse(rawArgs);
  const periodA = resolveRange(args.period_a_start, args.period_a_end);
  const periodB = resolveRange(args.period_b_start, args.period_b_end);
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, args.budget_name);
  const [a, b, periodAEvidence, periodBEvidence] = await Promise.all([
    summarizeSpendingPeriod(context, periodA, filters),
    summarizeSpendingPeriod(context, periodB, filters),
    loadTransactionRecordEvidence({
      context,
      where: { ...transactionWhere(context.workspaceId, periodA, filters), direction: "DEBIT" },
      suffix: "spending-a",
      limit: 4,
    }),
    loadTransactionRecordEvidence({
      context,
      where: { ...transactionWhere(context.workspaceId, periodB, filters), direction: "DEBIT" },
      suffix: "spending-b",
      limit: 4,
    }),
  ]);
  const changeCents = a.totalCents - b.totalCents;
  const changePercent = b.totalCents === 0 ? null : Math.round((changeCents / b.totalCents) * 10_000) / 100;
  const comparisonEvidence = evidence(
    context.callId,
    "comparison",
    "Spending comparison",
    `${a.start}–${a.end} compared with ${b.start}–${b.end}`,
    transactionHref({ from: a.start, to: a.end, accountName: args.account_name, budgetName: args.budget_name }),
  );
  const comparisonEvidenceItems = [...periodAEvidence, ...periodBEvidence];
  const resolvedComparisonEvidence = comparisonEvidenceItems.length ? comparisonEvidenceItems : [comparisonEvidence];
  return {
    output: {
      ok: true,
      evidence: resolvedComparisonEvidence,
      filters: resolvedFilterOutput(filters),
      periodA: a,
      periodB: b,
      changeCents,
      change: formatAmount(changeCents, context.currency),
      changePercent,
      presentation: {
        type: "trend_chart",
        title: "Spending comparison",
        currency: context.currency,
        points: [
          { label: b.start.slice(0, 7), valueCents: b.totalCents, formattedValue: b.total },
          { label: a.start.slice(0, 7), valueCents: a.totalCents, formattedValue: a.total },
        ],
      },
    },
    evidence: resolvedComparisonEvidence,
  };
}

type CategorySpendingKey = (typeof CATEGORY_SPENDING_KEYS)[number];
type ConcreteCategorySpendingKey = Exclude<CategorySpendingKey, "ALL">;

type CategorizedTransaction = {
  id: string;
  accountId: string;
  budgetId: string | null;
  date: Date;
  subject: string;
  details: string | null;
  notes: string | null;
  amountCents: number;
  account: { workspaceId: string; name: string };
  budget: { workspaceId: string; name: string } | null;
  classification: {
    category: string;
    label: string;
    confidence: "HIGH" | "MEDIUM" | "NONE";
    source: string;
    rule: string;
  };
};

function sumCategoryAmounts(rows: CategorizedTransaction[]) {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;
}

async function summarizeCategorySpendingPeriod(params: {
  context: AskNestToolContext;
  range: DateRange;
  filters: ResolvedTransactionFilters;
  category: CategorySpendingKey;
  limit: number;
}) {
  const transactions = await prisma.transaction.findMany({
    where: {
      ...transactionWhere(params.context.workspaceId, params.range, params.filters),
      direction: "DEBIT",
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      accountId: true,
      budgetId: true,
      date: true,
      subject: true,
      details: true,
      notes: true,
      amountCents: true,
      account: { select: { workspaceId: true, name: true } },
      budget: { select: { workspaceId: true, name: true } },
    },
  });
  const categorized: CategorizedTransaction[] = transactions.map((transaction) => ({
    ...transaction,
    classification: classifyTransactionCategory({
      subject: transaction.subject,
      details: transaction.details,
      notes: transaction.notes,
      budgetName: transaction.budget?.workspaceId === params.context.workspaceId ? transaction.budget.name : null,
    }),
  }));
  const matchesRequestedCategory = (row: CategorizedTransaction) => (
    params.category === "ALL" || row.classification.category === params.category
  );
  const confirmed = categorized.filter((row) => row.classification.confidence === "HIGH" && matchesRequestedCategory(row));
  const uncertain = categorized.filter((row) => row.classification.confidence === "MEDIUM" && matchesRequestedCategory(row));
  const unclassified = categorized.filter((row) => row.classification.confidence === "NONE");
  const confirmedCents = sumCategoryAmounts(confirmed);
  const possibleAdditionalCents = sumCategoryAmounts(uncertain);
  const allDebitCents = sumCategoryAmounts(categorized);

  const categoriesByKey = new Map<string, { category: string; label: string; amountCents: number; transactionCount: number }>();
  for (const row of confirmed) {
    const key = row.classification.category;
    const current = categoriesByKey.get(key) ?? {
      category: key,
      label: row.classification.label,
      amountCents: 0,
      transactionCount: 0,
    };
    current.amountCents += row.amountCents;
    current.transactionCount += 1;
    categoriesByKey.set(key, current);
  }
  const categories = [...categoriesByKey.values()]
    .sort((left, right) => right.amountCents - left.amountCents || left.label.localeCompare(right.label))
    .slice(0, params.limit)
    .map((row) => ({
      ...row,
      amount: formatAmount(row.amountCents, params.context.currency),
      shareOfAllDebitPercent: percentage(row.amountCents, allDebitCents),
    }));

  const merchantsByKey = new Map<string, { merchant: string; amountCents: number; transactionCount: number }>();
  for (const row of confirmed) {
    const merchant = canonicalizeMerchant(row.subject);
    const key = merchant.toLocaleLowerCase();
    const current = merchantsByKey.get(key) ?? { merchant, amountCents: 0, transactionCount: 0 };
    current.amountCents += row.amountCents;
    current.transactionCount += 1;
    merchantsByKey.set(key, current);
  }
  const merchants = [...merchantsByKey.values()]
    .sort((left, right) => right.amountCents - left.amountCents || left.merchant.localeCompare(right.merchant))
    .slice(0, params.limit)
    .map((row) => ({
      ...row,
      amount: formatAmount(row.amountCents, params.context.currency),
      shareOfConfirmedPercent: percentage(row.amountCents, confirmedCents),
    }));

  return {
    start: params.range.startLabel,
    end: params.range.endLabel,
    category: params.category,
    categoryLabel: params.category === "ALL"
      ? "All categories"
      : TRANSACTION_CATEGORY_LABELS[params.category as ConcreteCategorySpendingKey],
    confirmedCents,
    confirmed: formatAmount(confirmedCents, params.context.currency),
    confirmedTransactionCount: confirmed.length,
    possibleAdditionalCents,
    possibleAdditional: formatAmount(possibleAdditionalCents, params.context.currency),
    possibleTransactionCount: uncertain.length,
    potentialMaximumCents: confirmedCents + possibleAdditionalCents,
    potentialMaximum: formatAmount(confirmedCents + possibleAdditionalCents, params.context.currency),
    allDebitCents,
    allDebit: formatAmount(allDebitCents, params.context.currency),
    allDebitTransactionCount: categorized.length,
    unclassifiedCents: sumCategoryAmounts(unclassified),
    unclassified: formatAmount(sumCategoryAmounts(unclassified), params.context.currency),
    unclassifiedTransactionCount: unclassified.length,
    confirmedCoveragePercent: percentage(
      sumCategoryAmounts(categorized.filter((row) => row.classification.confidence === "HIGH")),
      allDebitCents,
    ),
    categories,
    merchants: params.category === "ALL" ? [] : merchants,
    supportingTransactions: [...confirmed, ...uncertain].slice(0, 8).map((row) => ({
      id: row.id,
      accountId: row.accountId,
      budgetId: row.budgetId,
      date: row.date,
      subject: row.subject,
      amountCents: row.amountCents,
      amount: formatAmount(row.amountCents, params.context.currency),
      subAccount: row.budget?.workspaceId === params.context.workspaceId ? row.budget.name : "Unassigned",
      confidence: row.classification.confidence,
    })),
    uncertainTransactions: uncertain.slice(0, 10).map((row) => ({
      date: formatDate(row.date),
      subject: row.subject,
      amountCents: row.amountCents,
      amount: formatAmount(row.amountCents, params.context.currency),
      account: row.account.workspaceId === params.context.workspaceId ? row.account.name : "Unavailable",
      subAccount: row.budget?.workspaceId === params.context.workspaceId ? row.budget.name : "Unassigned",
      reason: row.classification.rule,
    })),
  };
}

async function getCategorySpending(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = CategorySpendingArgsSchema.parse(rawArgs);
  if (Boolean(args.period_b_start) !== Boolean(args.period_b_end)) {
    throw new AskNestToolInputError("Comparison start and end dates must either both be supplied or both be null.");
  }
  const periodA = resolveRange(args.period_a_start, args.period_a_end);
  const periodB = args.period_b_start && args.period_b_end
    ? resolveRange(args.period_b_start, args.period_b_end)
    : null;
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, null);
  const [a, b] = await Promise.all([
    summarizeCategorySpendingPeriod({ context, range: periodA, filters, category: args.category, limit: args.limit }),
    periodB
      ? summarizeCategorySpendingPeriod({ context, range: periodB, filters, category: args.category, limit: args.limit })
      : Promise.resolve(null),
  ]);
  const changeCents = b ? a.confirmedCents - b.confirmedCents : null;
  const changePercent = b && b.confirmedCents !== 0
    ? Math.round(((a.confirmedCents - b.confirmedCents) / b.confirmedCents) * 10_000) / 100
    : null;
  const categoryLabel = args.category === "ALL"
    ? "Semantic spending categories"
    : `${TRANSACTION_CATEGORY_LABELS[args.category as ConcreteCategorySpendingKey]} spending`;
  const categoryEvidence = evidence(
    context.callId,
    "category-spending",
    categoryLabel,
    b
      ? `${a.start}–${a.end} compared with ${b.start}–${b.end}`
      : `${a.start} to ${a.end} · ${a.allDebitTransactionCount} debit transactions analyzed`,
    transactionHref({ from: a.start, to: a.end, accountName: args.account_name }),
  );
  const transactionEvidence = [
    ...transactionRecordEvidence({
      context,
      rows: a.supportingTransactions,
      suffix: "category-a",
      limit: b ? 4 : 8,
    }),
    ...(b
      ? transactionRecordEvidence({
          context,
          rows: b.supportingTransactions,
          suffix: "category-b",
          limit: 4,
        })
      : []),
  ].slice(0, 8);
  const categoryEvidenceItems = transactionEvidence.length ? transactionEvidence : [categoryEvidence];
  return {
    output: {
      ok: true,
      evidence: categoryEvidenceItems,
      method: "DETERMINISTIC_TRANSACTION_CLASSIFICATION",
      disclaimer: "Confirmed totals use high-confidence merchant, description, or clearly named sub-account rules. Possible spending is shown separately and is not included in confirmed totals. Uncategorized transactions may make category totals incomplete.",
      filters: {
        category: args.category,
        ...resolvedFilterOutput(filters),
      },
      periodA: a,
      periodB: b,
      changeCents,
      change: changeCents === null ? null : formatAmount(changeCents, context.currency),
      changePercent,
      returned: args.category === "ALL" ? a.categories.length : a.merchants.length,
      ...(b
        ? {
            presentation: {
              type: "trend_chart",
              title: categoryLabel,
              currency: context.currency,
              points: [
                { label: b.start.slice(0, 7), valueCents: b.confirmedCents, formattedValue: b.confirmed },
                { label: a.start.slice(0, 7), valueCents: a.confirmedCents, formattedValue: a.confirmed },
              ],
            },
          }
        : {}),
    },
    evidence: categoryEvidenceItems,
  };
}

async function findTransactions(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = FindTransactionsArgsSchema.parse(rawArgs);
  const range = recentRange(args.start_date, args.end_date);
  const textQuery = args.query;
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, args.budget_name);
  const baseWhere = transactionWhere(context.workspaceId, range, filters);
  const where: Prisma.TransactionWhereInput = {
    ...baseWhere,
    ...(textQuery
      ? { AND: [transactionTextWhere(textQuery)] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
      select: {
        id: true,
        accountId: true,
        budgetId: true,
        date: true,
        subject: true,
        amountCents: true,
        direction: true,
        kind: true,
        account: { select: { workspaceId: true, name: true, bankName: true } },
        budget: { select: { workspaceId: true, name: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);
  const transactionEvidence = evidence(
    context.callId,
    "transactions",
    `${total} matching transaction${total === 1 ? "" : "s"}`,
    `${range.startLabel} to ${range.endLabel}${args.query ? ` · “${args.query}”` : ""}`,
    transactionHref({
      from: range.startLabel,
      to: range.endLabel,
      search: args.query,
      accountName: args.account_name,
      budgetName: args.budget_name,
    }),
  );
  const recordEvidence = transactionRecordEvidence({ context, rows, suffix: "transaction" });
  const transactionEvidenceItems = recordEvidence.length ? recordEvidence : [transactionEvidence];
  return {
    output: {
      ok: true,
      evidence: transactionEvidenceItems,
      filters: {
        query: textQuery,
        start: range.startLabel,
        end: range.endLabel,
        ...resolvedFilterOutput(filters),
      },
      totalMatches: total,
      returned: rows.length,
      transactions: rows.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        budgetId: row.budgetId,
        date: formatDate(row.date),
        subject: row.subject,
        amountCents: row.amountCents,
        amount: formatAmount(row.amountCents, context.currency),
        direction: row.direction,
        kind: row.kind,
        account: row.account.workspaceId === context.workspaceId ? row.account.name : "Unavailable",
        bank: row.account.workspaceId === context.workspaceId ? row.account.bankName : null,
        budget: row.budget?.workspaceId === context.workspaceId ? row.budget.name : "Unassigned",
      })),
    },
    evidence: transactionEvidenceItems,
  };
}

async function getCardObligations(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = CardObligationsArgsSchema.parse(rawArgs);
  const obligations = await loadCardObligations(context.workspaceId, context.currency, args.before_date);
  const totalCents = obligations.reduce((sum, item) => sum + item.outstandingCents, 0);
  const cardEvidence = evidence(
    context.callId,
    "cards",
    `${obligations.length} outstanding card statement${obligations.length === 1 ? "" : "s"}`,
    args.before_date ? `Due through ${args.before_date}` : "All recorded payment due dates",
    "/credit-transactions",
  );
  return {
    output: {
      ok: true,
      evidence: [cardEvidence],
      throughDate: args.before_date,
      totalCents,
      total: formatAmount(totalCents, context.currency),
      obligations,
    },
    evidence: [cardEvidence],
  };
}

async function findCardTransactions(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = FindCardTransactionsArgsSchema.parse(rawArgs);
  const range = recentRange(args.start_date, args.end_date);
  const cardResolution = await resolveAskNestCard(context.workspaceId, args.card_name);
  const where: Prisma.CreditCardTransactionWhereInput = {
    workspaceId: context.workspaceId,
    transactionDate: { gte: range.start, lt: range.endExclusive },
    ...(args.query ? { subject: { contains: args.query } } : {}),
    ...(args.allocation_status === "ALLOCATED"
      ? { isAllocated: true }
      : args.allocation_status === "UNALLOCATED"
        ? { isAllocated: false }
        : {}),
    ...(cardResolution?.matched
      ? { creditCardId: { in: cardResolution.ids } }
      : args.card_name
      ? {
          creditCard: {
            workspaceId: context.workspaceId,
            OR: [
              { cardName: { contains: args.card_name } },
              { bankName: { contains: args.card_name } },
            ],
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.creditCardTransaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
      select: {
        transactionDate: true,
        paymentDueDate: true,
        statementMonth: true,
        statementYear: true,
        amountCents: true,
        subject: true,
        isAllocated: true,
        budgetId: true,
        creditCard: { select: { workspaceId: true, cardName: true, bankName: true } },
      },
    }),
    prisma.creditCardTransaction.count({ where }),
  ]);
  const budgetIds = rows.map((row) => row.budgetId).filter((id): id is string => Boolean(id));
  const budgets = budgetIds.length
    ? await prisma.budgetEnvelope.findMany({
        where: { workspaceId: context.workspaceId, id: { in: budgetIds } },
        select: { id: true, name: true },
      })
    : [];
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget.name]));
  const cardActivityEvidence = evidence(
    context.callId,
    "card-transactions",
    `${total} matching card transaction${total === 1 ? "" : "s"}`,
    `${range.startLabel} to ${range.endLabel} · ${args.allocation_status.toLocaleLowerCase()}`,
    "/credit-transactions",
  );
  return {
    output: {
      ok: true,
      evidence: [cardActivityEvidence],
      filters: {
        query: args.query,
        start: range.startLabel,
        end: range.endLabel,
        cardName: args.card_name,
        entityResolution: cardResolution ? {
          matched: cardResolution.matched,
          labels: cardResolution.labels,
          confidence: cardResolution.confidence,
          method: cardResolution.method,
        } : null,
        allocationStatus: args.allocation_status,
      },
      totalMatches: total,
      returned: rows.length,
      transactions: rows.map((row) => ({
        date: formatDate(row.transactionDate),
        subject: row.subject,
        amountCents: row.amountCents,
        amount: formatAmount(row.amountCents, context.currency),
        card: row.creditCard.workspaceId === context.workspaceId ? row.creditCard.cardName : "Unavailable",
        bank: row.creditCard.workspaceId === context.workspaceId ? row.creditCard.bankName : null,
        statement: `${row.statementYear}-${String(row.statementMonth).padStart(2, "0")}`,
        paymentDueDate: row.paymentDueDate ? formatDate(row.paymentDueDate) : null,
        allocated: row.isAllocated,
        budget: row.budgetId ? budgetById.get(row.budgetId) ?? null : null,
      })),
    },
    evidence: [cardActivityEvidence],
  };
}

async function getReceivables(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = ReceivablesArgsSchema.parse(rawArgs);
  const throughExclusive = args.through_date
    ? addUtcDays(parseIsoDate(args.through_date, "Through date"), 1)
    : null;
  const where: Prisma.ReceivableWhereInput = {
    workspaceId: context.workspaceId,
    ...(args.status !== "ANY" ? { status: args.status } : {}),
    ...(throughExclusive ? { date: { lt: throughExclusive } } : {}),
  };
  const [rows, aggregate, total] = await Promise.all([
    prisma.receivable.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: args.limit,
      select: {
        title: true,
        amountCents: true,
        date: true,
        transactionDate: true,
        status: true,
        account: { select: { workspaceId: true, name: true } },
        budget: { select: { workspaceId: true, name: true } },
      },
    }),
    prisma.receivable.aggregate({ where, _sum: { amountCents: true } }),
    prisma.receivable.count({ where }),
  ]);
  const totalCents = aggregate._sum.amountCents ?? 0;
  const receivableEvidence = evidence(
    context.callId,
    "receivables",
    `${total} receivable${total === 1 ? "" : "s"}`,
    `${args.status === "ANY" ? "All statuses" : args.status}${args.through_date ? ` · through ${args.through_date}` : ""}`,
    "/receivables",
  );
  return {
    output: {
      ok: true,
      evidence: [receivableEvidence],
      status: args.status,
      throughDate: args.through_date,
      totalMatches: total,
      totalCents,
      total: formatAmount(totalCents, context.currency),
      returned: rows.length,
      receivables: rows.map((row) => ({
        title: row.title,
        amountCents: row.amountCents,
        amount: formatAmount(row.amountCents, context.currency),
        recordDate: formatDate(row.date),
        transactionDate: row.transactionDate ? formatDate(row.transactionDate) : null,
        status: row.status,
        account: row.account?.workspaceId === context.workspaceId ? row.account.name : null,
        budget: row.budget?.workspaceId === context.workspaceId ? row.budget.name : null,
      })),
    },
    evidence: [receivableEvidence],
  };
}

async function getBudgetPlan(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = BudgetPlanArgsSchema.parse(rawArgs);
  const plan = await prisma.monthlyBudgetPlan.findUnique({
    where: { workspaceId_year_month: { workspaceId: context.workspaceId, year: args.year, month: args.month } },
    select: {
      status: true,
      confirmedAt: true,
      updatedAt: true,
      sources: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { title: true, amountCents: true },
      },
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          title: true,
          amountCents: true,
          appliedCents: true,
          destinationSubAccount: { select: { workspaceId: true, name: true } },
        },
      },
    },
  });
  const sourceTotalCents = plan?.sources.reduce((sum, source) => sum + source.amountCents, 0) ?? 0;
  const itemTotalCents = plan?.items.reduce((sum, item) => sum + item.amountCents, 0) ?? 0;
  const period = `${args.year}-${String(args.month).padStart(2, "0")}`;
  const planEvidence = evidence(
    context.callId,
    "budget-plan",
    `Budget plan for ${period}`,
    plan ? `${plan.status} · updated ${formatDate(plan.updatedAt)}` : "No monthly plan found",
    "/budgets/plan",
  );
  return {
    output: {
      ok: true,
      evidence: [planEvidence],
      period,
      found: Boolean(plan),
      status: plan?.status ?? null,
      confirmedAt: plan?.confirmedAt?.toISOString() ?? null,
      sourceTotalCents,
      sourceTotal: formatAmount(sourceTotalCents, context.currency),
      itemTotalCents,
      itemTotal: formatAmount(itemTotalCents, context.currency),
      remainingCents: sourceTotalCents - itemTotalCents,
      remaining: formatAmount(sourceTotalCents - itemTotalCents, context.currency),
      sources: plan?.sources.map((source) => ({
        title: source.title,
        amount: formatAmount(source.amountCents, context.currency),
      })) ?? [],
      items: plan?.items.map((item) => ({
        title: item.title,
        amount: formatAmount(item.amountCents, context.currency),
        applied: formatAmount(item.appliedCents, context.currency),
        destination: item.destinationSubAccount?.workspaceId === context.workspaceId
          ? item.destinationSubAccount.name
          : null,
      })) ?? [],
    },
    evidence: [planEvidence],
  };
}

async function explainReconciliation(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = ReconciliationArgsSchema.parse(rawArgs);
  const [allRows, accountResolution] = await Promise.all([
    getBankConsistency(prisma, context.workspaceId),
    resolveAskNestAccount(context.workspaceId, args.account_name),
  ]);
  const accountQuery = args.account_name?.toLocaleLowerCase();
  const rows = accountResolution?.matched
    ? allRows.filter((row) => accountResolution.ids.includes(row.id))
    : accountQuery
    ? allRows.filter((row) => row.name.toLocaleLowerCase().includes(accountQuery))
    : allRows;
  const reconciliationEvidence = evidence(
    context.callId,
    "reconciliation",
    `${rows.length} bank reconciliation row${rows.length === 1 ? "" : "s"}`,
    args.account_name ? `Account filter: “${args.account_name}”` : "All configured bank accounts",
    "/",
  );
  return {
    output: {
      ok: true,
      evidence: [reconciliationEvidence],
      accountFilter: args.account_name,
      entityResolution: accountResolution ? {
        matched: accountResolution.matched,
        labels: accountResolution.labels,
        confidence: accountResolution.confidence,
        method: accountResolution.method,
      } : null,
      rows: rows.map((row) => ({
        name: row.name,
        configuredBalanceCents: row.currentBalanceCents,
        configuredBalance: formatAmount(row.currentBalanceCents, context.currency),
        linkedSubAccountTotalCents: row.linkedBudgetTotalCents,
        linkedSubAccountTotal: formatAmount(row.linkedBudgetTotalCents, context.currency),
        discrepancyCents: row.discrepancyCents,
        discrepancy: formatAmount(row.discrepancyCents, context.currency),
        reconciled: row.discrepancyCents === 0,
      })),
    },
    evidence: [reconciliationEvidence],
  };
}

async function getSpendingBreakdown(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = SpendingBreakdownArgsSchema.parse(rawArgs);
  const range = resolveRange(args.start_date, args.end_date);
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, args.budget_name);
  const where: Prisma.TransactionWhereInput = {
    ...transactionWhere(context.workspaceId, range, filters),
    direction: "DEBIT",
  };
  const [rows, recordEvidence] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["date", "budgetId"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
      orderBy: { date: "asc" },
    }),
    loadTransactionRecordEvidence({ context, where, suffix: "spending-breakdown" }),
  ]);
  const budgetIds = [...new Set(rows.map((row) => row.budgetId).filter((id): id is string => Boolean(id)))];
  const budgets = budgetIds.length
    ? await prisma.budgetEnvelope.findMany({
        where: { workspaceId: context.workspaceId, id: { in: budgetIds } },
        select: { id: true, name: true },
      })
    : [];
  const budgetById = new Map(budgets.map((budget) => [budget.id, budget.name]));
  const buckets = new Map<string, Map<string, { amountCents: number; transactionCount: number }>>();

  for (const row of rows) {
    const date = formatDate(row.date);
    const period = args.granularity === "YEAR" ? date.slice(0, 4) : date.slice(0, 7);
    const budget = row.budgetId ? budgetById.get(row.budgetId) ?? "Unknown sub-account" : "Unassigned";
    const byBudget = buckets.get(period) ?? new Map();
    const current = byBudget.get(budget) ?? { amountCents: 0, transactionCount: 0 };
    current.amountCents += row._sum.amountCents ?? 0;
    current.transactionCount += row._count._all;
    byBudget.set(budget, current);
    buckets.set(period, byBudget);
  }

  const periods = [...buckets.entries()].map(([period, byBudget]) => {
    const allSubAccounts = [...byBudget.entries()]
      .map(([name, value]) => ({
        name,
        amountCents: value.amountCents,
        amount: formatAmount(value.amountCents, context.currency),
        transactionCount: value.transactionCount,
      }))
      .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
    const totalCents = allSubAccounts.reduce((sum, item) => sum + item.amountCents, 0);
    const visibleSubAccounts = allSubAccounts.slice(0, 30);
    const remainingSubAccounts = allSubAccounts.slice(30);
    const other = remainingSubAccounts.length
      ? {
          name: `Other (${remainingSubAccounts.length} sub-accounts)`,
          amountCents: remainingSubAccounts.reduce((sum, item) => sum + item.amountCents, 0),
          amount: formatAmount(remainingSubAccounts.reduce((sum, item) => sum + item.amountCents, 0), context.currency),
          transactionCount: remainingSubAccounts.reduce((sum, item) => sum + item.transactionCount, 0),
        }
      : null;
    const subAccounts = other ? [...visibleSubAccounts, other] : visibleSubAccounts;
    return {
      period,
      totalCents,
      total: formatAmount(totalCents, context.currency),
      transactionCount: allSubAccounts.reduce((sum, item) => sum + item.transactionCount, 0),
      subAccounts,
    };
  });
  const totalCents = periods.reduce((sum, period) => sum + period.totalCents, 0);
  const breakdownEvidence = evidence(
    context.callId,
    "spending-breakdown",
    `${periods.length} ${args.granularity.toLocaleLowerCase()} spending bucket${periods.length === 1 ? "" : "s"}`,
    `${range.startLabel} to ${range.endLabel} · grouped by sub-account`,
    transactionHref({
      from: range.startLabel,
      to: range.endLabel,
      accountName: args.account_name,
      budgetName: args.budget_name,
    }),
  );
  const breakdownEvidenceItems = recordEvidence.length ? recordEvidence : [breakdownEvidence];
  return {
    output: {
      ok: true,
      evidence: breakdownEvidenceItems,
      filters: {
        start: range.startLabel,
        end: range.endLabel,
        granularity: args.granularity,
        ...resolvedFilterOutput(filters),
      },
      totalCents,
      total: formatAmount(totalCents, context.currency),
      periods,
      presentation: {
        type: "trend_chart",
        title: args.granularity === "MONTH" ? "Monthly spending trend" : "Yearly spending trend",
        currency: context.currency,
        points: periods.map((period) => ({
          label: period.period,
          valueCents: period.totalCents,
          formattedValue: period.total,
        })),
      },
    },
    evidence: breakdownEvidenceItems,
  };
}

async function getInvestmentSummary(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = InvestmentSummaryArgsSchema.parse(rawArgs);
  const asOf = args.as_of_date ?? getTodayIso();
  const endExclusive = addUtcDays(parseIsoDate(asOf, "As-of date"), 1);
  const accounts = await prisma.investmentAccount.findMany({
    where: {
      workspaceId: context.workspaceId,
      inceptionDate: { lt: endExclusive },
      ...(args.account_name
        ? {
            OR: [
              { displayName: { contains: args.account_name } },
              { productName: { contains: args.account_name } },
              { institutionName: { contains: args.account_name } },
            ],
          }
        : {}),
    },
    orderBy: [{ inceptionDate: "asc" }, { createdAt: "asc" }],
    take: 50,
    select: {
      displayName: true,
      productName: true,
      institutionName: true,
      inceptionDate: true,
      divestedDate: true,
      isLiquid: true,
      entries: {
        where: { date: { lt: endExclusive } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { date: true, investedCents: true, currentValueCents: true },
      },
    },
  });
  const rows = accounts.map((account) => {
    const latest = account.entries[0] ?? null;
    const gainLossCents = latest ? latest.currentValueCents - latest.investedCents : 0;
    return {
      name: account.displayName || account.productName,
      product: account.productName,
      institution: account.institutionName,
      inceptionDate: formatDate(account.inceptionDate),
      divestedDate: account.divestedDate ? formatDate(account.divestedDate) : null,
      isLiquid: account.isLiquid,
      latestEntryDate: latest ? formatDate(latest.date) : null,
      investedCents: latest?.investedCents ?? 0,
      invested: formatAmount(latest?.investedCents ?? 0, context.currency),
      currentValueCents: latest?.currentValueCents ?? 0,
      currentValue: formatAmount(latest?.currentValueCents ?? 0, context.currency),
      gainLossCents,
      gainLoss: formatAmount(gainLossCents, context.currency),
      hasValuation: Boolean(latest),
    };
  });
  const investedCents = rows.reduce((sum, row) => sum + row.investedCents, 0);
  const currentValueCents = rows.reduce((sum, row) => sum + row.currentValueCents, 0);
  const investmentEvidence = evidence(
    context.callId,
    "investments",
    `${rows.length} investment account${rows.length === 1 ? "" : "s"}`,
    `Recorded values as of ${asOf}`,
    "/investments",
  );
  return {
    output: {
      ok: true,
      evidence: [investmentEvidence],
      asOf,
      accountFilter: args.account_name,
      totals: {
        investedCents,
        invested: formatAmount(investedCents, context.currency),
        currentValueCents,
        currentValue: formatAmount(currentValueCents, context.currency),
        gainLossCents: currentValueCents - investedCents,
        gainLoss: formatAmount(currentValueCents - investedCents, context.currency),
      },
      accounts: rows,
      presentation: {
        type: "investment_chart",
        title: `Recorded investment values as of ${asOf}`,
        currency: context.currency,
        items: rows.filter((row) => row.hasValuation).slice(0, 12).map((row) => ({
          label: row.name,
          investedCents: row.investedCents,
          currentValueCents: row.currentValueCents,
          invested: row.invested,
          currentValue: row.currentValue,
        })),
      },
    },
    evidence: [investmentEvidence],
  };
}

async function getTripSpending(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = TripSpendingArgsSchema.parse(rawArgs);
  const range = resolveRange(args.start_date, args.end_date);
  const groups = await prisma.transactionGroup.findMany({
    where: {
      workspaceId: context.workspaceId,
      transactions: {
        some: {
          workspaceId: context.workspaceId,
          voidedAt: null,
          kind: { not: "REVERSAL" },
          direction: "DEBIT",
          date: { gte: range.start, lt: range.endExclusive },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      icon: true,
      budget: { select: { id: true, workspaceId: true, name: true } },
      transactions: {
        where: {
          workspaceId: context.workspaceId,
          voidedAt: null,
          kind: { not: "REVERSAL" },
          direction: "DEBIT",
          date: { gte: range.start, lt: range.endExclusive },
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        select: { date: true, amountCents: true },
      },
    },
  });
  const query = args.query?.toLocaleLowerCase() ?? null;
  const travelPattern = /\b(trip|holiday|travel|vacation|tour|flight|hotel)\b/i;
  const candidates = groups.filter((group) => {
    const text = `${group.name} ${group.budget.workspaceId === context.workspaceId ? group.budget.name : ""}`;
    return query
      ? text.toLocaleLowerCase().includes(query)
      : travelPattern.test(text) || getDestinationFlag(text, group.icon) !== "🧳";
  });
  let estimated = false;
  let disclaimer: string | null = null;
  let trips = candidates.slice(0, 30).map((group) => {
    const first = group.transactions[0]?.date;
    const last = group.transactions.at(-1)?.date;
    const amountCents = group.transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0);
    const href = transactionHref({
      budgetId: group.budget.id,
      groupId: group.id,
      from: range.startLabel,
      to: range.endLabel,
    });
    return {
      id: group.id,
      name: group.name,
      flag: getDestinationFlag(`${group.name} ${group.budget.name}`, group.icon),
      subAccount: group.budget.workspaceId === context.workspaceId ? group.budget.name : "Unavailable",
      startDate: first ? formatDate(first) : null,
      endDate: last ? formatDate(last) : null,
      amountCents,
      amount: formatAmount(amountCents, context.currency),
      transactionCount: group.transactions.length,
      href,
    };
  });
  if (!trips.length) {
    const transactions = await prisma.transaction.findMany({
      where: {
        workspaceId: context.workspaceId,
        voidedAt: null,
        kind: { not: "REVERSAL" },
        direction: "DEBIT",
        date: { gte: range.start, lt: range.endExclusive },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 500,
      select: {
        date: true,
        subject: true,
        details: true,
        notes: true,
        amountCents: true,
        budget: { select: { workspaceId: true, name: true } },
      },
    });
    const hints = [...new Set([
      ...args.destination_hints,
      ...(args.query && !travelPattern.test(args.query) ? [args.query] : []),
    ].map((hint) => hint.trim()).filter(Boolean))];
    const buckets = new Map<string, {
      name: string;
      flag: string;
      search: string;
      amountCents: number;
      transactionCount: number;
      startDate: Date;
      endDate: Date;
      subAccounts: Set<string>;
    }>();
    for (const transaction of transactions) {
      const text = `${transaction.subject} ${transaction.details ?? ""} ${transaction.notes ?? ""}`;
      const normalized = text.toLocaleLowerCase();
      const hint = hints.find((value) => normalized.includes(value.toLocaleLowerCase()));
      const detected = hint ? null : findDestination(text);
      if (!hint && !detected) continue;
      const search = hint ?? detected![0];
      const name = formatDestinationLabel(hint ?? detected![0]);
      const key = name.toLocaleLowerCase();
      const bucket = buckets.get(key) ?? {
        name,
        flag: getDestinationFlag(hint ?? detected![0], null),
        search,
        amountCents: 0,
        transactionCount: 0,
        startDate: transaction.date,
        endDate: transaction.date,
        subAccounts: new Set<string>(),
      };
      bucket.amountCents += transaction.amountCents;
      bucket.transactionCount += 1;
      if (transaction.date < bucket.startDate) bucket.startDate = transaction.date;
      if (transaction.date > bucket.endDate) bucket.endDate = transaction.date;
      if (transaction.budget?.workspaceId === context.workspaceId) bucket.subAccounts.add(transaction.budget.name);
      buckets.set(key, bucket);
    }
    trips = [...buckets.values()]
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 30)
      .map((bucket, index) => ({
        id: `estimated-${index + 1}`,
        name: bucket.name,
        flag: bucket.flag,
        subAccount: [...bucket.subAccounts].join(", ") || "Matched transactions",
        startDate: formatDate(bucket.startDate),
        endDate: formatDate(bucket.endDate),
        amountCents: bucket.amountCents,
        amount: formatAmount(bucket.amountCents, context.currency),
        transactionCount: bucket.transactionCount,
        href: transactionHref({
          from: range.startLabel,
          to: range.endLabel,
          search: bucket.search,
        }),
      }));
    estimated = trips.length > 0;
    disclaimer = estimated
      ? "Estimated from transaction text matches because no explicit trip groups were found. Transactions may be missed or assigned to the wrong destination; review the filtered supporting data."
      : null;
  }
  const totalCents = trips.reduce((sum, trip) => sum + trip.amountCents, 0);
  const summaryEvidence = evidence(
    context.callId,
    "trip-summary",
    `${trips.length} ${estimated ? "estimated destination" : "recorded trip group"}${trips.length === 1 ? "" : "s"}`,
    `${range.startLabel} to ${range.endLabel}${estimated ? " · text-match estimate" : ""}`,
    transactionHref({ from: range.startLabel, to: range.endLabel }),
  );
  const tripEvidence = trips.slice(0, 7).map((trip, index) => evidence(
    context.callId,
    `trip-${index + 1}`,
    `${trip.flag} ${trip.name}`,
    `${trip.startDate ?? range.startLabel} to ${trip.endDate ?? range.endLabel} · ${trip.amount}`,
    trip.href,
  ));
  return {
    output: {
      ok: true,
      evidence: [summaryEvidence, ...tripEvidence],
      period: { start: range.startLabel, end: range.endLabel },
      query: args.query,
      method: estimated ? "TRANSACTION_TEXT_ESTIMATE" : "EXPLICIT_TRIP_GROUPS",
      estimated,
      disclaimer,
      totalCents,
      total: formatAmount(totalCents, context.currency),
      trips,
      presentation: {
        type: "trip_cards",
        title: estimated ? "Estimated spending by destination" : "Recorded trip spending",
        disclaimer: disclaimer ?? undefined,
        items: trips.slice(0, 12).map((trip) => ({
          label: trip.name,
          flag: trip.flag,
          amount: trip.amount,
          dateRange: trip.startDate === trip.endDate
            ? trip.startDate ?? range.startLabel
            : `${trip.startDate ?? range.startLabel} to ${trip.endDate ?? range.endLabel}`,
          href: trip.href,
        })),
      },
    },
    evidence: [summaryEvidence, ...tripEvidence],
  };
}

async function summarizeCashFlowPeriod(
  context: AskNestToolContext,
  range: DateRange,
  filters: ResolvedTransactionFilters,
) {
  const where = transactionWhere(context.workspaceId, range, filters);
  const [directions, subjects] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["direction"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["subject", "direction"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
      orderBy: { _sum: { amountCents: "desc" } },
      take: 120,
    }),
  ]);
  const incomeCents = directions.find((row) => row.direction === "CREDIT")?._sum.amountCents ?? 0;
  const spendingCents = directions.find((row) => row.direction === "DEBIT")?._sum.amountCents ?? 0;
  return {
    start: range.startLabel,
    end: range.endLabel,
    incomeCents,
    income: formatAmount(incomeCents, context.currency),
    spendingCents,
    spending: formatAmount(spendingCents, context.currency),
    netCents: incomeCents - spendingCents,
    net: formatAmount(incomeCents - spendingCents, context.currency),
    transactionCount: directions.reduce((sum, row) => sum + row._count._all, 0),
    subjects: subjects.map((row) => ({
      name: canonicalizeMerchant(row.subject),
      direction: row.direction,
      amountCents: row._sum.amountCents ?? 0,
      transactionCount: row._count._all,
    })),
  };
}

function changedSubjectDrivers(
  periodA: Awaited<ReturnType<typeof summarizeCashFlowPeriod>>,
  periodB: Awaited<ReturnType<typeof summarizeCashFlowPeriod>>,
  currency: string,
  direction?: "CREDIT" | "DEBIT",
) {
  const totals = new Map<string, { name: string; direction: string; periodACents: number; periodBCents: number }>();
  for (const row of periodA.subjects) {
    if (direction && row.direction !== direction) continue;
    const key = `${row.direction}:${row.name.toLocaleLowerCase()}`;
    const current = totals.get(key) ?? { name: row.name, direction: row.direction, periodACents: 0, periodBCents: 0 };
    current.periodACents += row.amountCents;
    totals.set(key, current);
  }
  for (const row of periodB.subjects) {
    if (direction && row.direction !== direction) continue;
    const key = `${row.direction}:${row.name.toLocaleLowerCase()}`;
    const current = totals.get(key) ?? { name: row.name, direction: row.direction, periodACents: 0, periodBCents: 0 };
    current.periodBCents += row.amountCents;
    totals.set(key, current);
  }
  return [...totals.values()]
    .map((row) => {
      const changeCents = row.periodACents - row.periodBCents;
      return {
        ...row,
        periodA: formatAmount(row.periodACents, currency),
        periodB: formatAmount(row.periodBCents, currency),
        changeCents,
        change: formatAmount(changeCents, currency),
      };
    })
    .sort((left, right) => Math.abs(right.changeCents) - Math.abs(left.changeCents) || left.name.localeCompare(right.name))
    .slice(0, 10);
}

async function explainCashFlowChange(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = ExplainCashFlowChangeArgsSchema.parse(rawArgs);
  const periodA = resolveRange(args.period_a_start, args.period_a_end);
  const periodB = resolveRange(args.period_b_start, args.period_b_end);
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, null);
  const [a, b, periodAEvidence, periodBEvidence] = await Promise.all([
    summarizeCashFlowPeriod(context, periodA, filters),
    summarizeCashFlowPeriod(context, periodB, filters),
    loadTransactionRecordEvidence({
      context,
      where: transactionWhere(context.workspaceId, periodA, filters),
      suffix: "cash-flow-a",
      limit: 4,
    }),
    loadTransactionRecordEvidence({
      context,
      where: transactionWhere(context.workspaceId, periodB, filters),
      suffix: "cash-flow-b",
      limit: 4,
    }),
  ]);
  const incomeChangeCents = a.incomeCents - b.incomeCents;
  const spendingChangeCents = a.spendingCents - b.spendingCents;
  const netChangeCents = a.netCents - b.netCents;
  const cashFlowEvidence = evidence(
    context.callId,
    "cash-flow-change",
    "Cash-flow change",
    `${a.start}–${a.end} compared with ${b.start}–${b.end}`,
    transactionHref({ from: a.start, to: a.end, accountName: args.account_name }),
  );
  const cashFlowEvidenceItems = [...periodAEvidence, ...periodBEvidence];
  const resolvedCashFlowEvidence = cashFlowEvidenceItems.length ? cashFlowEvidenceItems : [cashFlowEvidence];
  return {
    output: {
      ok: true,
      evidence: resolvedCashFlowEvidence,
      filters: resolvedFilterOutput(filters),
      periodA: { ...a, subjects: undefined },
      periodB: { ...b, subjects: undefined },
      change: {
        incomeCents: incomeChangeCents,
        income: formatAmount(incomeChangeCents, context.currency),
        spendingCents: spendingChangeCents,
        spending: formatAmount(spendingChangeCents, context.currency),
        netCents: netChangeCents,
        net: formatAmount(netChangeCents, context.currency),
      },
      drivers: changedSubjectDrivers(a, b, context.currency),
    },
    evidence: resolvedCashFlowEvidence,
  };
}

async function compareIncome(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = CompareIncomeArgsSchema.parse(rawArgs);
  const periodA = resolveRange(args.period_a_start, args.period_a_end);
  const periodB = resolveRange(args.period_b_start, args.period_b_end);
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, null);
  const [a, b, periodAEvidence, periodBEvidence] = await Promise.all([
    summarizeCashFlowPeriod(context, periodA, filters),
    summarizeCashFlowPeriod(context, periodB, filters),
    loadTransactionRecordEvidence({
      context,
      where: { ...transactionWhere(context.workspaceId, periodA, filters), direction: "CREDIT" },
      suffix: "income-a",
      limit: 4,
    }),
    loadTransactionRecordEvidence({
      context,
      where: { ...transactionWhere(context.workspaceId, periodB, filters), direction: "CREDIT" },
      suffix: "income-b",
      limit: 4,
    }),
  ]);
  const changeCents = a.incomeCents - b.incomeCents;
  const changePercent = b.incomeCents === 0 ? null : Math.round((changeCents / b.incomeCents) * 10_000) / 100;
  const incomeEvidence = evidence(
    context.callId,
    "income-comparison",
    "Income comparison",
    `${a.start}–${a.end} compared with ${b.start}–${b.end}`,
    transactionHref({ from: a.start, to: a.end, accountName: args.account_name }),
  );
  const incomeEvidenceItems = [...periodAEvidence, ...periodBEvidence];
  const resolvedIncomeEvidence = incomeEvidenceItems.length ? incomeEvidenceItems : [incomeEvidence];
  return {
    output: {
      ok: true,
      evidence: resolvedIncomeEvidence,
      filters: resolvedFilterOutput(filters),
      periodA: { start: a.start, end: a.end, totalCents: a.incomeCents, total: a.income },
      periodB: { start: b.start, end: b.end, totalCents: b.incomeCents, total: b.income },
      changeCents,
      change: formatAmount(changeCents, context.currency),
      changePercent,
      sources: changedSubjectDrivers(a, b, context.currency, "CREDIT"),
    },
    evidence: resolvedIncomeEvidence,
  };
}

async function getTopSpendingDrivers(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = TopSpendingDriversArgsSchema.parse(rawArgs);
  const range = resolveRange(args.start_date, args.end_date);
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, args.budget_name);
  const where: Prisma.TransactionWhereInput = {
    ...transactionWhere(context.workspaceId, range, filters),
    direction: "DEBIT",
  };
  const totalAggregate = await prisma.transaction.aggregate({ where, _sum: { amountCents: true }, _count: { _all: true } });
  const totalCents = totalAggregate._sum.amountCents ?? 0;
  let drivers: Array<{ name: string; amountCents: number; transactionCount: number }>;
  if (args.dimension === "SUB_ACCOUNT") {
    const rows = await prisma.transaction.groupBy({
      by: ["budgetId"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
      orderBy: { _sum: { amountCents: "desc" } },
      take: 100,
    });
    const budgetIds = rows.map((row) => row.budgetId).filter((id): id is string => Boolean(id));
    const budgets = budgetIds.length ? await prisma.budgetEnvelope.findMany({
      where: { workspaceId: context.workspaceId, id: { in: budgetIds } },
      select: { id: true, name: true },
    }) : [];
    const budgetById = new Map(budgets.map((budget) => [budget.id, budget.name]));
    drivers = rows.map((row) => ({
      name: row.budgetId ? budgetById.get(row.budgetId) ?? "Unknown sub-account" : "Unassigned",
      amountCents: row._sum.amountCents ?? 0,
      transactionCount: row._count._all,
    }));
  } else {
    const rows = await prisma.transaction.groupBy({
      by: ["subject"],
      where,
      _sum: { amountCents: true },
      _count: { _all: true },
      orderBy: { _sum: { amountCents: "desc" } },
      take: 500,
    });
    const normalized = new Map<string, { name: string; amountCents: number; transactionCount: number }>();
    for (const row of rows) {
      const name = canonicalizeMerchant(row.subject);
      const key = name.toLocaleLowerCase();
      const current = normalized.get(key) ?? { name, amountCents: 0, transactionCount: 0 };
      current.amountCents += row._sum.amountCents ?? 0;
      current.transactionCount += row._count._all;
      normalized.set(key, current);
    }
    drivers = [...normalized.values()].sort((left, right) => right.amountCents - left.amountCents || left.name.localeCompare(right.name));
  }
  const visibleDrivers = drivers.slice(0, args.limit).map((driver) => ({
    ...driver,
    amount: formatAmount(driver.amountCents, context.currency),
    sharePercent: totalCents === 0 ? 0 : Math.round((driver.amountCents / totalCents) * 10_000) / 100,
  }));
  const driverEvidence = evidence(
    context.callId,
    "spending-drivers",
    `Top spending by ${args.dimension === "MERCHANT" ? "merchant" : "sub-account"}`,
    `${range.startLabel} to ${range.endLabel} · ${totalAggregate._count._all} debit transactions`,
    transactionHref({ from: range.startLabel, to: range.endLabel, accountName: args.account_name, budgetName: args.budget_name }),
  );
  const driverRecordEvidence = await loadTransactionRecordEvidence({
    context,
    where,
    suffix: "spending-driver",
    orderBy: [{ amountCents: "desc" }, { date: "desc" }, { id: "desc" }],
  });
  const driverEvidenceItems = driverRecordEvidence.length ? driverRecordEvidence : [driverEvidence];
  return {
    output: {
      ok: true,
      evidence: driverEvidenceItems,
      filters: { start: range.startLabel, end: range.endLabel, dimension: args.dimension, ...resolvedFilterOutput(filters) },
      totalCents,
      total: formatAmount(totalCents, context.currency),
      transactionCount: totalAggregate._count._all,
      returned: visibleDrivers.length,
      drivers: visibleDrivers,
    },
    evidence: driverEvidenceItems,
  };
}

async function getBudgetVsActual(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = BudgetVsActualArgsSchema.parse(rawArgs);
  const period = `${args.year}-${String(args.month).padStart(2, "0")}`;
  const start = `${period}-01`;
  const endDate = new Date(Date.UTC(args.month === 12 ? args.year + 1 : args.year, args.month === 12 ? 0 : args.month, 0));
  const end = formatDate(endDate);
  const range = resolveRange(start, end);
  const budgetResolution = await resolveAskNestBudget(context.workspaceId, args.budget_name);
  const filters: ResolvedTransactionFilters = {
    accountName: null,
    budgetName: args.budget_name,
    ...(budgetResolution?.matched ? { budgetIds: budgetResolution.ids } : {}),
    resolutions: budgetResolution ? [budgetResolution] : [],
  };
  const actualWhere: Prisma.TransactionWhereInput = {
    ...transactionWhere(context.workspaceId, range, filters),
    direction: "DEBIT",
  };
  const [plan, actualRows, actualRecordEvidence] = await Promise.all([
    prisma.monthlyBudgetPlan.findUnique({
      where: { workspaceId_year_month: { workspaceId: context.workspaceId, year: args.year, month: args.month } },
      select: {
        status: true,
        updatedAt: true,
        items: {
          select: {
            title: true,
            amountCents: true,
            destinationSubAccountId: true,
            destinationSubAccount: { select: { workspaceId: true, name: true } },
          },
        },
      },
    }),
    prisma.transaction.groupBy({
      by: ["budgetId"],
      where: actualWhere,
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    loadTransactionRecordEvidence({ context, where: actualWhere, suffix: "budget-actual" }),
  ]);
  const actualBudgetIds = actualRows.map((row) => row.budgetId).filter((id): id is string => Boolean(id));
  const actualBudgets = actualBudgetIds.length ? await prisma.budgetEnvelope.findMany({
    where: { workspaceId: context.workspaceId, id: { in: actualBudgetIds } },
    select: { id: true, name: true },
  }) : [];
  const names = new Map(actualBudgets.map((budget) => [budget.id, budget.name]));
  const comparisons = new Map<string, { name: string; plannedCents: number; actualCents: number; transactionCount: number }>();
  for (const item of plan?.items ?? []) {
    if (budgetResolution?.matched && (!item.destinationSubAccountId || !budgetResolution.ids.includes(item.destinationSubAccountId))) continue;
    if (!budgetResolution?.matched && args.budget_name) {
      const label = item.destinationSubAccount?.name ?? item.title;
      if (!label.toLocaleLowerCase().includes(args.budget_name.toLocaleLowerCase())) continue;
    }
    const key = item.destinationSubAccountId ?? `plan:${item.title.toLocaleLowerCase()}`;
    const current = comparisons.get(key) ?? {
      name: item.destinationSubAccount?.workspaceId === context.workspaceId ? item.destinationSubAccount.name : item.title,
      plannedCents: 0,
      actualCents: 0,
      transactionCount: 0,
    };
    current.plannedCents += item.amountCents;
    comparisons.set(key, current);
  }
  for (const row of actualRows) {
    const key = row.budgetId ?? "unassigned";
    const current = comparisons.get(key) ?? {
      name: row.budgetId ? names.get(row.budgetId) ?? "Unknown sub-account" : "Unassigned",
      plannedCents: 0,
      actualCents: 0,
      transactionCount: 0,
    };
    current.actualCents += row._sum.amountCents ?? 0;
    current.transactionCount += row._count._all;
    comparisons.set(key, current);
  }
  const rows = [...comparisons.values()].map((row) => {
    const varianceCents = row.plannedCents - row.actualCents;
    return {
      ...row,
      planned: formatAmount(row.plannedCents, context.currency),
      actual: formatAmount(row.actualCents, context.currency),
      varianceCents,
      variance: formatAmount(varianceCents, context.currency),
      usagePercent: row.plannedCents === 0 ? null : Math.round((row.actualCents / row.plannedCents) * 10_000) / 100,
      status: row.plannedCents === 0 && row.actualCents > 0 ? "UNPLANNED" : varianceCents < 0 ? "OVER" : varianceCents > 0 ? "UNDER" : "ON_PLAN",
    };
  }).sort((left, right) => right.actualCents - left.actualCents || left.name.localeCompare(right.name));
  const plannedCents = rows.reduce((sum, row) => sum + row.plannedCents, 0);
  const actualCents = rows.reduce((sum, row) => sum + row.actualCents, 0);
  const budgetEvidence = evidence(
    context.callId,
    "budget-vs-actual",
    `Budget versus actual for ${period}`,
    plan ? `${plan.status} plan · updated ${formatDate(plan.updatedAt)}` : "No monthly budget plan found",
    "/budgets/plan",
  );
  const budgetEvidenceItems = actualRecordEvidence.length ? actualRecordEvidence : [budgetEvidence];
  return {
    output: {
      ok: true,
      evidence: budgetEvidenceItems,
      period,
      foundPlan: Boolean(plan),
      planStatus: plan?.status ?? null,
      filters: resolvedFilterOutput(filters),
      totals: {
        plannedCents,
        planned: formatAmount(plannedCents, context.currency),
        actualCents,
        actual: formatAmount(actualCents, context.currency),
        varianceCents: plannedCents - actualCents,
        variance: formatAmount(plannedCents - actualCents, context.currency),
      },
      returned: rows.length,
      rows,
    },
    evidence: budgetEvidenceItems,
  };
}

function recurringCadence(medianDays: number) {
  if (medianDays >= 5 && medianDays <= 9) return "WEEKLY";
  if (medianDays >= 12 && medianDays <= 17) return "FORTNIGHTLY";
  if (medianDays >= 25 && medianDays <= 35) return "MONTHLY";
  if (medianDays >= 75 && medianDays <= 100) return "QUARTERLY";
  if (medianDays >= 330 && medianDays <= 400) return "ANNUAL";
  return null;
}

async function findRecurringSpend(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = RecurringSpendArgsSchema.parse(rawArgs);
  const range = resolveRange(args.start_date, args.end_date);
  const filters = await resolveTransactionFilters(context.workspaceId, args.account_name, args.budget_name);
  const transactions = await prisma.transaction.findMany({
    where: { ...transactionWhere(context.workspaceId, range, filters), direction: "DEBIT" },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: 2_000,
    select: {
      id: true,
      accountId: true,
      budgetId: true,
      date: true,
      subject: true,
      amountCents: true,
      budget: { select: { workspaceId: true, name: true } },
    },
  });
  const merchants = new Map<string, { name: string; dates: Date[]; amounts: number[] }>();
  for (const transaction of transactions) {
    const name = canonicalizeMerchant(transaction.subject);
    const key = name.toLocaleLowerCase();
    const current = merchants.get(key) ?? { name, dates: [], amounts: [] };
    current.dates.push(transaction.date);
    current.amounts.push(transaction.amountCents);
    merchants.set(key, current);
  }
  const patterns = [...merchants.values()].flatMap((merchant) => {
    if (merchant.dates.length < args.min_occurrences) return [];
    const intervals = merchant.dates.slice(1).map((date, index) => Math.round((date.getTime() - merchant.dates[index]!.getTime()) / 86_400_000));
    const orderedIntervals = [...intervals].sort((left, right) => left - right);
    const medianDays = orderedIntervals[Math.floor(orderedIntervals.length / 2)] ?? 0;
    const cadence = recurringCadence(medianDays);
    if (!cadence) return [];
    const totalCents = merchant.amounts.reduce((sum, amount) => sum + amount, 0);
    const averageCents = Math.round(totalCents / merchant.amounts.length);
    return [{
      merchant: merchant.name,
      cadence,
      medianIntervalDays: medianDays,
      occurrences: merchant.dates.length,
      firstDate: formatDate(merchant.dates[0]!),
      lastDate: formatDate(merchant.dates.at(-1)!),
      averageCents,
      average: formatAmount(averageCents, context.currency),
      totalCents,
      total: formatAmount(totalCents, context.currency),
      amountRange: `${formatAmount(Math.min(...merchant.amounts), context.currency)} to ${formatAmount(Math.max(...merchant.amounts), context.currency)}`,
    }];
  }).sort((left, right) => right.totalCents - left.totalCents || left.merchant.localeCompare(right.merchant));
  const visiblePatterns = patterns.slice(0, args.limit);
  const recurringEvidence = evidence(
    context.callId,
    "recurring-spend",
    `${visiblePatterns.length} potential recurring payment pattern${visiblePatterns.length === 1 ? "" : "s"}`,
    `${range.startLabel} to ${range.endLabel} · analyzed ${transactions.length}${transactions.length === 2_000 ? "+" : ""} debit transactions`,
    transactionHref({ from: range.startLabel, to: range.endLabel, accountName: args.account_name, budgetName: args.budget_name }),
  );
  const recurringMerchantKeys = new Set(visiblePatterns.map((pattern) => pattern.merchant.toLocaleLowerCase()));
  const recurringRecordEvidence = transactionRecordEvidence({
    context,
    rows: transactions.filter((transaction) => (
      recurringMerchantKeys.has(canonicalizeMerchant(transaction.subject).toLocaleLowerCase())
    )),
    suffix: "recurring-transaction",
  });
  const recurringEvidenceItems = recurringRecordEvidence.length ? recurringRecordEvidence : [recurringEvidence];
  return {
    output: {
      ok: true,
      evidence: recurringEvidenceItems,
      disclaimer: "Potential recurring patterns are inferred from recorded dates and normalized merchant text. Review the supporting transactions before treating them as subscriptions or obligations.",
      filters: { start: range.startLabel, end: range.endLabel, minOccurrences: args.min_occurrences, ...resolvedFilterOutput(filters) },
      analyzedTransactions: transactions.length,
      truncated: transactions.length === 2_000,
      totalMatches: patterns.length,
      returned: visiblePatterns.length,
      patterns: visiblePatterns,
    },
    evidence: recurringEvidenceItems,
  };
}

async function searchWorkspaceKnowledge(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = SearchWorkspaceKnowledgeArgsSchema.parse(rawArgs);
  try {
    const results = await searchAskNestKnowledge({
      workspaceId: context.workspaceId,
      userId: context.userId,
      query: args.query,
      limit: args.limit,
    });
    const knowledgeEvidence = results.map((result, index) => evidence(
      context.callId,
      `knowledge-${index + 1}`,
      result.title,
      `${result.sourceType} · hybrid workspace search`,
      result.href,
    ));
    return {
      output: {
        ok: true,
        method: "AZURE_AI_SEARCH_HYBRID",
        query: args.query,
        totalMatches: results.length,
        returned: results.length,
        evidence: knowledgeEvidence,
        passages: results.map((result, index) => ({
          evidenceId: knowledgeEvidence[index]?.id,
          title: result.title,
          content: result.content,
          sourceType: result.sourceType,
          sourceId: result.sourceId,
          score: result.score,
          rerankerScore: result.rerankerScore,
        })),
      },
      evidence: knowledgeEvidence,
    };
  } catch {
    return {
      output: {
        ok: false,
        unavailable: true,
        totalMatches: 0,
        returned: 0,
        error: "Workspace knowledge search is temporarily unavailable. Do not infer an answer from missing passages.",
      },
      evidence: [],
    };
  }
}

export async function executeAskNestTool(
  name: string,
  rawArgs: unknown,
  context: AskNestToolContext,
): Promise<AskNestToolResult> {
  switch (name) {
    case "get_financial_snapshot":
      return getFinancialSnapshot(rawArgs, context);
    case "compare_spending":
      return compareSpending(rawArgs, context);
    case "get_category_spending":
      return getCategorySpending(rawArgs, context);
    case "find_transactions":
      return findTransactions(rawArgs, context);
    case "get_card_obligations":
      return getCardObligations(rawArgs, context);
    case "find_card_transactions":
      return findCardTransactions(rawArgs, context);
    case "get_receivables":
      return getReceivables(rawArgs, context);
    case "get_budget_plan":
      return getBudgetPlan(rawArgs, context);
    case "explain_reconciliation":
      return explainReconciliation(rawArgs, context);
    case "get_spending_breakdown":
      return getSpendingBreakdown(rawArgs, context);
    case "get_investment_summary":
      return getInvestmentSummary(rawArgs, context);
    case "get_trip_spending":
      return getTripSpending(rawArgs, context);
    case "explain_cash_flow_change":
      return explainCashFlowChange(rawArgs, context);
    case "compare_income":
      return compareIncome(rawArgs, context);
    case "get_top_spending_drivers":
      return getTopSpendingDrivers(rawArgs, context);
    case "get_budget_vs_actual":
      return getBudgetVsActual(rawArgs, context);
    case "find_recurring_spend":
      return findRecurringSpend(rawArgs, context);
    case "search_workspace_knowledge":
      return searchWorkspaceKnowledge(rawArgs, context);
    default:
      throw new AskNestToolInputError("Ask Nest requested an unsupported read tool.");
  }
}
