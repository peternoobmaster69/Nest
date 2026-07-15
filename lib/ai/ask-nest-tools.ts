import type { Prisma } from "@prisma/client";
import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import { getBankConsistency } from "@/lib/bank-consistency";
import { prisma } from "@/lib/prisma";
import type { AskNestEvidence } from "@/lib/ai/ask-nest-types";

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
];

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

function transactionWhere(
  workspaceId: string,
  range: DateRange,
  filters?: { accountName?: string | null; budgetName?: string | null },
): Prisma.TransactionWhereInput {
  return {
    workspaceId,
    voidedAt: null,
    kind: { not: "REVERSAL" },
    date: { gte: range.start, lt: range.endExclusive },
    ...(filters?.accountName
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
    ...(filters?.budgetName
      ? { budget: { workspaceId, name: { contains: filters.budgetName } } }
      : {}),
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
  accountName: string | null,
  budgetName: string | null,
) {
  const where: Prisma.TransactionWhereInput = {
    ...transactionWhere(context.workspaceId, range, { accountName, budgetName }),
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
  const [a, b] = await Promise.all([
    summarizeSpendingPeriod(context, periodA, args.account_name, args.budget_name),
    summarizeSpendingPeriod(context, periodB, args.account_name, args.budget_name),
  ]);
  const changeCents = a.totalCents - b.totalCents;
  const changePercent = b.totalCents === 0 ? null : Math.round((changeCents / b.totalCents) * 10_000) / 100;
  const comparisonEvidence = evidence(
    context.callId,
    "comparison",
    "Spending comparison",
    `${a.start}–${a.end} compared with ${b.start}–${b.end}`,
    "/transactions",
  );
  return {
    output: {
      ok: true,
      evidence: [comparisonEvidence],
      filters: { accountName: args.account_name, budgetName: args.budget_name },
      periodA: a,
      periodB: b,
      changeCents,
      change: formatAmount(changeCents, context.currency),
      changePercent,
    },
    evidence: [comparisonEvidence],
  };
}

async function findTransactions(rawArgs: unknown, context: AskNestToolContext): Promise<AskNestToolResult> {
  const args = FindTransactionsArgsSchema.parse(rawArgs);
  const range = recentRange(args.start_date, args.end_date);
  const baseWhere = transactionWhere(context.workspaceId, range, {
    accountName: args.account_name,
    budgetName: args.budget_name,
  });
  const where: Prisma.TransactionWhereInput = {
    ...baseWhere,
    ...(args.query
      ? {
          AND: [
            {
              OR: [
                { subject: { contains: args.query } },
                { details: { contains: args.query } },
              ],
            },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
      select: {
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
    "/transactions",
  );
  return {
    output: {
      ok: true,
      evidence: [transactionEvidence],
      filters: {
        query: args.query,
        start: range.startLabel,
        end: range.endLabel,
        accountName: args.account_name,
        budgetName: args.budget_name,
      },
      totalMatches: total,
      returned: rows.length,
      transactions: rows.map((row) => ({
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
    evidence: [transactionEvidence],
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
  const where: Prisma.CreditCardTransactionWhereInput = {
    workspaceId: context.workspaceId,
    transactionDate: { gte: range.start, lt: range.endExclusive },
    ...(args.query ? { subject: { contains: args.query } } : {}),
    ...(args.allocation_status === "ALLOCATED"
      ? { isAllocated: true }
      : args.allocation_status === "UNALLOCATED"
        ? { isAllocated: false }
        : {}),
    ...(args.card_name
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
  const allRows = await getBankConsistency(prisma, context.workspaceId);
  const accountQuery = args.account_name?.toLocaleLowerCase();
  const rows = accountQuery
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
    default:
      throw new AskNestToolInputError("Ask Nest requested an unsupported read tool.");
  }
}
