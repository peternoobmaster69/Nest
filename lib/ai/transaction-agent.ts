import { Prisma, type TransactionAgentDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyTransactionBudgetDelta } from "@/lib/budget-ledger";
import { correctLedgerTransactionInPosting, createLedgerTransaction, executePosting, PostingConflictError } from "@/lib/domains/ledger";
import { AiConfigurationError } from "./config";
import { interpretTransactionMessage, type TransactionInterpreter } from "./transaction-agent-parser";
import { getAgentConfiguration } from "./agent-runtime";
import { AgentPolicyError, assertAgentCapability, assertAgentEnabled } from "./agent-policy";
import {
  AgentEditError, agentMoney, agentToday, applyAgentEdit, applyPendingReply, normalizeAccountName, parseAgentAmount,
  parseTransactionFallback, planTransactionReview, shiftAgentDate, validAgentDate, type AgentUsage,
} from "./transaction-agent-core";
import {
  EMPTY_TRANSACTION_INTENT, type AgentBudget, type AgentLastSaved, type AgentState, type AgentTransaction,
  type TransactionAgentRequest, type TransactionAgentView, type TransactionIntent,
} from "./transaction-agent-contracts";

type Scope = { workspaceId: string; userId: string };
/** Callers pass the auth context, which has extra fields (such as role). Queries spread only these two. */
const toScope = ({ workspaceId, userId }: Scope): Scope => ({ workspaceId, userId });
type Db = Prisma.TransactionClient;
const DRAFT_LIFETIME_MS = 30 * 60_000;
const transactionSelect = {
  id: true, accountId: true, budgetId: true, subject: true, amountCents: true,
  direction: true, kind: true, date: true, updatedAt: true, groupId: true, details: true, notes: true,
} as const;
const correctableWhere: Prisma.TransactionWhereInput = {
  voidedAt: null, kind: { in: ["EXPENSE", "INCOME", "ADJUSTMENT"] },
  direction: { in: ["DEBIT", "CREDIT", "Incoming", "Outgoing"] },
  creditCardTransactionId: null, receivableId: null, creditCardLinks: { none: {} },
  OR: [{ postingGroupId: null }, { postingGroup: { operation: { in: ["TRANSACTION_CREATE", "TRANSACTION_UPDATE", "TRANSACTION_BULK_IMPORT", "TRANSACTION_CORRECTION"] } } }],
};

/** Thrown inside the confirmation transaction; the caller rebuilds the review instead of failing. */
class StaleReviewError extends PostingConflictError {}

function serializeTransaction(row: Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>): AgentTransaction {
  return { ...row, direction: row.direction === "CREDIT" || row.direction === "Incoming" ? "CREDIT" : "DEBIT", date: row.date.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function loadContext(scope: Scope, db: Db = prisma) {
  const [workspace, rows] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: scope.workspaceId }, select: { baseCurrency: true } }),
    db.budgetEnvelope.findMany({
      where: { workspaceId: scope.workspaceId, isActive: true, account: { isActive: true, workspaceId: scope.workspaceId } },
      select: { id: true, accountId: true, name: true, availableCents: true, account: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }], take: 501,
    }),
  ]);
  if (rows.length > 500) throw new PostingConflictError("This workspace has too many sub-accounts for the transaction assistant. Use the Transactions page.");
  const currency = workspace.baseCurrency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new PostingConflictError("Set a valid workspace currency first.");
  return { currency, budgets: rows.map(({ account, ...b }) => ({ ...b, accountName: account.name })) };
}

/** Which sub-accounts this workspace uses, overall and for similar descriptions. Only orders choices. */
async function loadUsage(scope: Scope, subject: string | null): Promise<AgentUsage> {
  const today = agentToday();
  const count = async (where: Prisma.TransactionWhereInput) => {
    const rows = await prisma.transaction.groupBy({
      by: ["budgetId"], _count: { _all: true },
      where: { workspaceId: scope.workspaceId, voidedAt: null, kind: { in: ["EXPENSE", "INCOME"] }, budgetId: { not: null }, ...where },
      orderBy: { _count: { budgetId: "desc" } }, take: 20,
    });
    return new Map(rows.filter((row) => row.budgetId).map((row) => [row.budgetId!, row._count._all]));
  };
  const term = subject?.trim().split(/\s+/).find((word) => word.length >= 3) ?? null;
  const [recent, similar] = await Promise.all([
    count({ date: { gte: new Date(`${shiftAgentDate(today, -90)}T00:00:00.000Z`) } }),
    term ? count({ date: { gte: new Date(`${shiftAgentDate(today, -365)}T00:00:00.000Z`) }, subject: { contains: term } }) : Promise.resolve(new Map<string, number>()),
  ]);
  return { recent, similar };
}

function readState(draft: TransactionAgentDraft): AgentState {
  const state = JSON.parse(draft.stateJson) as AgentState;
  return { ...state, intent: { ...EMPTY_TRANSACTION_INTENT, ...state.intent } };
}

export function transactionAgentView(draft: TransactionAgentDraft): TransactionAgentView {
  const state = readState(draft);
  const expired = draft.expiresAt.getTime() <= Date.now() && !["SAVED", "CANCELLED"].includes(draft.status);
  return {
    draftId: draft.id, revision: draft.revision,
    status: expired ? "EXPIRED" : draft.status as TransactionAgentView["status"],
    expiresAt: draft.expiresAt.toISOString(),
    message: expired ? "This draft expired. Start a new request to review current balances." : state.message,
    choices: expired ? [] : state.choices, review: expired ? null : state.review,
    messages: state.messages, pending: expired ? null : state.pending ?? null,
    savedTransactionId: state.savedTransactionId,
    nextRequest: draft.status === "SAVED" ? state.intent.deferred : null,
  };
}

export async function getTransactionAgentDraft(auth: Scope, id: string, db: Db = prisma) {
  const scope = toScope(auth);
  const draft = await db.transactionAgentDraft.findFirst({ where: { id, ...scope } });
  if (!draft) throw new PostingConflictError("Draft not found in this workspace.");
  return draft;
}

function assertEditable(draft: TransactionAgentDraft, revision: number) {
  if (draft.revision !== revision) throw new PostingConflictError("This draft changed in another request. Reload it before continuing.");
  if (draft.expiresAt.getTime() <= Date.now()) throw new PostingConflictError("This draft expired. Start a new request.");
  if (!["CLARIFY", "REVIEW"].includes(draft.status)) throw new PostingConflictError("This draft is already saved or cancelled.");
}

function appendMessage(state: AgentState, role: "user" | "assistant", content: string) {
  state.messages = [...state.messages, { role, content }].slice(-30);
}

async function loadTarget(scope: Scope, id: string, db: Db = prisma) {
  const row = await db.transaction.findFirst({ where: { ...correctableWhere, workspaceId: scope.workspaceId, id }, select: transactionSelect });
  return row ? serializeTransaction(row) : null;
}

/** The transaction saved by the user's previous draft, so "make that $12" can refer to it. */
async function loadLastSaved(scope: Scope, previousDraftId: string | undefined, budgets: AgentBudget[]): Promise<AgentLastSaved | null> {
  if (!previousDraftId) return null;
  const previous = await prisma.transactionAgentDraft.findFirst({ where: { id: previousDraftId, ...scope, status: "SAVED" } });
  const transactionId = previous ? readState(previous).savedTransactionId : undefined;
  const saved = transactionId ? await loadTarget(scope, transactionId) : null;
  if (!saved) return null;
  return { transactionId: saved.id, subject: saved.subject, amountCents: saved.amountCents, direction: saved.direction, date: saved.date, budgetName: budgets.find((b) => b.id === saved.budgetId)?.name ?? null };
}

function dayRange(day: string) {
  const start = new Date(`${day}T00:00:00.000Z`);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}

async function findTargets(scope: Scope, intent: TransactionIntent) {
  const { targetDate, targetAmount, targetQuery } = intent;
  const amountCents = targetAmount ? parseAgentAmount(targetAmount) : null;
  const filters: Prisma.TransactionWhereInput[] = [
    targetQuery ? { subject: { contains: targetQuery } } : {},
    amountCents ? { amountCents } : {},
    targetDate ? { date: dayRange(targetDate) } : {},
  ];
  const search = (where: Prisma.TransactionWhereInput[]) => prisma.transaction.findMany({
    where: { ...correctableWhere, workspaceId: scope.workspaceId, AND: where },
    orderBy: [{ date: "desc" }, { id: "desc" }], take: 11, select: transactionSelect,
  });
  const exact = await search(filters);
  if (exact.length || filters.filter((f) => Object.keys(f).length).length < 2) return { rows: exact, relaxed: false };
  // People misremember a date or amount more often than the description, so relax those first.
  for (const relaxed of [[filters[0], filters[1]], [filters[0], filters[2]], [filters[0]]]) {
    if (!relaxed.some((f) => Object.keys(f).length)) continue;
    const rows = await search(relaxed);
    if (rows.length) return { rows, relaxed: true };
  }
  return { rows: [], relaxed: false };
}

async function plan(scope: Scope, state: AgentState, budgets: AgentBudget[], currency: string): Promise<AgentState> {
  const intent = state.intent;
  const usage = await loadUsage(scope, intent.subject ?? intent.targetQuery);
  if (intent.operation === "UPDATE" && !intent.clarification) {
    if (state.transactionId) {
      const target = await loadTarget(scope, state.transactionId);
      if (!target) return { ...state, transactionId: null, choices: [], review: null, pending: "target", message: "That transaction can’t be corrected here any more (it may have been changed, or linked to a card or receivable). Describe another one." };
      return planTransactionReview(state, budgets, target, currency, agentToday(), usage);
    }
    if (intent.targetDate && !validAgentDate(intent.targetDate)) return { ...state, pending: "target", message: "What date was the original transaction? For example 2026-09-29 or “yesterday”.", choices: [], review: null };
    if (intent.targetAmount && !parseAgentAmount(intent.targetAmount)) return { ...state, pending: "target", message: "What was the original amount? For example 10 or 10.50.", choices: [], review: null };
    const { rows, relaxed } = await findTargets(scope, intent);
    const described = Boolean(intent.targetQuery || intent.targetDate || intent.targetAmount);
    // One exact match for what the person described goes straight to review, which shows the original next to the change.
    if (rows.length === 1 && !relaxed && described) {
      const next = planTransactionReview({ ...state, transactionId: rows[0].id }, budgets, serializeTransaction(rows[0]), currency, agentToday(), usage);
      return { ...next, transactionId: rows[0].id };
    }
    const describe = (row: (typeof rows)[number]) => `${row.date.toISOString().slice(0, 10)} · ${row.direction === "CREDIT" || row.direction === "Incoming" ? "+" : "−"}${agentMoney(row.amountCents, currency)} · ${budgets.find((b) => b.id === row.budgetId)?.name ?? "Unassigned"}`;
    const message = !described
      ? `Which transaction should I correct? Here are the most recent. You can also describe it, for example “yesterday’s lunch”.`
      : !rows.length
      ? "I couldn’t find an ordinary transaction matching that. Try a different description, date, or amount. Card payments and receivables are edited on their own pages."
      : relaxed ? "I couldn’t find an exact match. Is it one of these?"
        : `Which one should I correct?${rows.length > 10 ? " These are the 10 most recent matches. Give a date or amount to narrow it down." : ""}`;
    return {
      ...state, review: null, pending: "target", message,
      choices: rows.slice(0, 10).map((row) => ({ kind: "transaction", id: row.id, label: row.subject, detail: describe(row) })),
    };
  }
  const next = planTransactionReview(state, budgets, null, currency, agentToday(), usage);
  if (next.review?.operation === "CREATE") {
    const after = next.review.after;
    const duplicate = await prisma.transaction.findFirst({ where: { workspaceId: scope.workspaceId, voidedAt: null, kind: { not: "REVERSAL" }, budgetId: after.budgetId, amountCents: after.amountCents, direction: after.direction, date: dayRange(after.date.slice(0, 10)) }, select: { subject: true } });
    if (duplicate) next.review.warnings.push(`There is already a ${agentMoney(after.amountCents, currency)} transaction (“${duplicate.subject}”) in this sub-account on that day. Confirm only if this is a separate one.`);
  }
  return next;
}

/** Merges a fresh interpretation into the draft, dropping selections the change invalidates. */
function mergeIntent(state: AgentState, intent: TransactionIntent, budgets: AgentBudget[]) {
  const names = new Set(budgets.map((b) => normalizeAccountName(b.name)));
  intent = { ...intent, accountCandidates: intent.accountCandidates.filter((name) => names.has(normalizeAccountName(name))) };
  const same = (a: string | null, b: string | null) => normalizeAccountName(a ?? "") === normalizeAccountName(b ?? "");
  if (!same(intent.accountQuery, state.intent.accountQuery) || !same(intent.bankQuery, state.intent.bankQuery)) state.budgetId = null;
  const targetChanged = intent.operation !== state.intent.operation || intent.targetQuery !== state.intent.targetQuery
    || intent.targetDate !== state.intent.targetDate || intent.targetAmount !== state.intent.targetAmount;
  if (intent.targetLastSaved && state.lastSaved) {
    state.transactionId = state.lastSaved.transactionId;
    intent = { ...intent, operation: "UPDATE" };
  } else if (targetChanged) {
    state.transactionId = null;
    state.budgetId = null;
  }
  state.intent = intent;
}

type AdvanceInput = Exclude<TransactionAgentRequest, { action: "confirm" }> | { action: "refresh"; draftId: string; revision: number; notice: string };

export async function advanceTransactionAgent(auth: Scope, input: AdvanceInput, interpret: TransactionInterpreter = interpretTransactionMessage) {
  const configuration = await getAgentConfiguration("transaction-assistant");
  if (input.action !== "cancel") assertAgentEnabled(configuration);
  const scope = toScope(auth);
  let draft: TransactionAgentDraft;
  if (input.action === "start") {
    const state: AgentState = { intent: { ...EMPTY_TRANSACTION_INTENT }, budgetId: null, transactionId: null, message: "Preparing your draft…", choices: [], review: null, messages: [] };
    draft = await prisma.transactionAgentDraft.create({ data: { ...scope, stateJson: JSON.stringify(state), expiresAt: new Date(Date.now() + DRAFT_LIFETIME_MS) } });
  } else {
    draft = await getTransactionAgentDraft(scope, input.draftId);
    assertEditable(draft, input.revision);
  }
  let state = readState(draft);
  let selection = input.action === "select" ? input.selection : null;
  const message = input.action === "start" || input.action === "message" ? input.message : null;
  // Numbered replies, exact labels, and a single-choice "yes" are resolved without a model.
  if (message && state.choices.length) {
    const normalized = normalizeAccountName(message);
    const exact = state.choices.filter((c) => normalizeAccountName(c.label) === normalized);
    const ordinal = /^\d{1,3}$/.test(message) ? state.choices[Number(message) - 1] : null;
    if (exact.length === 1) selection = exact[0];
    else if (ordinal) selection = ordinal;
    else if (/^(?:y|yes|yep|yeah|yes please|ok|okay|sure|correct|that one|that's it|thats it)[.!]?$/i.test(message) && state.choices.length === 1) selection = state.choices[0];
  }
  if (selection && !state.choices.some((c) => c.kind === selection.kind && c.id === selection.id)) throw new PostingConflictError("That option is no longer available. Reload the draft.");

  const previousChoices = state.choices;
  const previousPending = state.pending ?? null;
  state = { ...state, review: null, choices: [] };
  // Invalidate the old review BEFORE a model call. Concurrent confirmation cannot save it.
  const reserved = await prisma.transactionAgentDraft.updateMany({
    where: { id: draft.id, ...scope, revision: draft.revision, status: draft.status },
    data: { revision: { increment: 1 }, status: "CLARIFY", stateJson: JSON.stringify(state) },
  });
  if (reserved.count !== 1) throw new PostingConflictError("This draft changed. Reload it before continuing.");
  const revision = draft.revision + 1;
  if (input.action === "cancel" || (message && /^(?:cancel|never ?mind|stop|forget it|scrap (?:it|that)|no thanks)[.!]?$/i.test(message))) {
    state.intent.operation = "CANCEL";
    state.message = "Cancelled. No transaction was changed.";
  } else {
    const { budgets, currency } = await loadContext(scope);
    if (input.action === "start") state.lastSaved = await loadLastSaved(scope, input.previousDraftId, budgets);
    if (selection) {
      if (selection.kind === "budget") {
        const selectedBudget = budgets.find((b) => b.id === selection.id);
        if (!selectedBudget) throw new PostingConflictError("That sub-account is no longer available. Reload the draft.");
        state.budgetId = selectedBudget.id;
        state.pickBudget = false;
        state.intent.accountQuery = selectedBudget.name;
        state.intent.bankQuery = selectedBudget.accountName;
      } else state.transactionId = selection.id;
      appendMessage(state, "user", message ?? `${previousChoices.find((c) => c.id === selection.id)?.label}`);
      state = await plan(scope, state, budgets, currency);
    } else if (input.action === "edit") {
      try {
        state = applyAgentEdit({ ...state, pending: previousPending }, input.field, input.value);
        appendMessage(state, "user", input.field === "budget" ? "Choose a different sub-account" : `Change ${input.field === "subject" ? "description" : input.field} to ${input.field === "direction" ? (input.value === "DEBIT" ? "deduct" : "add") : input.value}`);
        state = await plan(scope, state, budgets, currency);
      } catch (error) {
        if (!(error instanceof AgentEditError)) throw error;
        state = await plan(scope, state, budgets, currency);
        state.message = `${error.message} ${state.message}`;
      }
    } else if (input.action === "refresh" || (message && /^(?:refresh|review again|refresh draft|try again)[.!]?$/i.test(message))) {
      if (message) appendMessage(state, "user", message);
      state = await plan(scope, state, budgets, currency);
      if (input.action === "refresh") state.message = `${input.notice} ${state.message}`;
    } else if (message) {
      appendMessage(state, "user", message);
      // A short, obvious answer to the question just asked needs no model call.
      const direct = applyPendingReply({ ...state, pending: previousPending }, message, agentToday(), budgets.find((b) => b.id === state.budgetId)?.name ?? null);
      if (direct) {
        state.intent = direct;
        state = await plan(scope, state, budgets, currency);
      } else {
        try {
          const intent = await interpret(message, { ...state, pending: previousPending }, scope.userId, currency, {
            accountNames: [...new Set(budgets.map((b) => b.name))], bankNames: [...new Set(budgets.map((b) => b.accountName))],
            configuration,
          });
          mergeIntent(state, intent, budgets);
          state = await plan(scope, state, budgets, currency);
        } catch (error) {
          if (error instanceof PostingConflictError || error instanceof AgentPolicyError) throw error;
          // Keep simple, new commands working during an AI outage. Everything still goes through review.
          const fallback = state.intent.operation === "CLARIFY" && !state.budgetId ? parseTransactionFallback(message) : null;
          if (fallback) {
            mergeIntent(state, fallback, budgets);
            state = await plan(scope, state, budgets, currency);
          } else {
            state.pending = previousPending;
            const unconfigured = error instanceof AiConfigurationError || (error instanceof Error && error.name === "AiConfigurationError");
            state.message = unconfigured
              ? "The assistant can’t understand free-form requests until the Azure AI workload is configured. Simple commands like “Deduct $10 from Transit for bus fare” still work."
              : "I couldn’t interpret that just now. Nothing has changed. Please try again, or rephrase it as a simple command like “Deduct $10 from Transit for bus fare”.";
          }
        }
      }
    }
  }
  const requiredCapability = state.intent.operation === "CREATE" ? "create-transactions" : state.intent.operation === "UPDATE" ? "correct-transactions" : null;
  if (requiredCapability && !configuration.capabilities.includes(requiredCapability)) {
    state.review = null;
    state.choices = [];
    state.message = `${state.intent.operation === "UPDATE" ? "Correcting" : "Creating"} transactions is disabled by your administrator.`;
  }
  appendMessage(state, "assistant", state.message);
  const status = state.intent.operation === "CANCEL" ? "CANCELLED" : state.review ? "REVIEW" : "CLARIFY";
  const saved = await prisma.transactionAgentDraft.updateMany({ where: { id: draft.id, ...scope, revision, status: "CLARIFY" }, data: { stateJson: JSON.stringify(state), status } });
  if (saved.count !== 1) throw new PostingConflictError("This draft changed. Reload it before continuing.");
  draft = await getTransactionAgentDraft(scope, draft.id);
  return transactionAgentView(draft);
}

export async function confirmTransactionAgent(auth: Scope, input: Extract<TransactionAgentRequest, { action: "confirm" }>) {
  const scope = toScope(auth);
  const draft = await getTransactionAgentDraft(scope, input.draftId);
  // Return the persisted receipt after a lost response, including when the draft has since expired.
  if (draft.status === "SAVED" && draft.revision === input.revision) return transactionAgentView(draft);
  assertEditable(draft, input.revision);
  const preview = readState(draft).review;
  if (draft.status !== "REVIEW" || !preview) throw new PostingConflictError("Complete the draft and review it before confirming.");
  const configuration = await getAgentConfiguration("transaction-assistant");
  assertAgentCapability(configuration, preview.operation === "UPDATE" ? "correct-transactions" : "create-transactions");
  try {
    const result = await executePosting({
      workspaceId: scope.workspaceId, actorUserId: scope.userId,
      operation: preview.operation === "UPDATE" ? "TRANSACTION_CORRECTION" : "TRANSACTION_CREATE",
      sourceType: preview.before ? "TRANSACTION" : "TRANSACTION_AGENT", sourceId: preview.before?.id ?? draft.id,
      idempotencyKey: `transaction-agent:${draft.id}`,
      request: { draftId: draft.id, revision: input.revision },
      reason: "User confirmed transaction assistant draft",
    }, async (db, postingGroupId) => {
      await db.$queryRaw(Prisma.sql`SELECT [id] FROM [TransactionAgentDraft] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${draft.id} AND [workspaceId] = ${scope.workspaceId} AND [userId] = ${scope.userId}`);
      const current = await getTransactionAgentDraft(scope, draft.id, db);
      assertEditable(current, input.revision);
      const state = readState(current);
      const review = state.review;
      if (current.status !== "REVIEW" || !review) throw new PostingConflictError("This review is no longer available.");
      const { budgets, currency } = await loadContext(scope, db);
      if (currency !== review.currency || review.balances.some((old) => {
        const fresh = budgets.find((b) => b.id === old.id);
        return !fresh || fresh.availableCents !== old.availableCents || fresh.accountId !== old.accountId || fresh.name !== old.name || fresh.accountName !== old.accountName;
      })) throw new StaleReviewError("A sub-account balance changed since this review.");
      const after = review.after;
      let transactionId: string;
      if (review.before) {
        await db.$queryRaw(Prisma.sql`SELECT [id] FROM [Transaction] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${review.before.id} AND [workspaceId] = ${scope.workspaceId}`);
        const source = await loadTarget(scope, review.before.id, db);
        if (!source || JSON.stringify(source) !== JSON.stringify(review.before)) throw new PostingConflictError("This transaction changed since you reviewed it. Start a fresh correction.");
        const correction = await correctLedgerTransactionInPosting(db, postingGroupId, {
          transactionId: source.id, actorUserId: scope.userId, reason: "User confirmed transaction assistant correction",
          replacement: { subject: after.subject, amountCents: after.amountCents, direction: after.direction, kind: after.kind, date: new Date(after.date), budgetId: after.budgetId },
        });
        transactionId = correction.replacementTransactionId;
      } else {
        const tx = await createLedgerTransaction(db, postingGroupId, { ...after, workspaceId: scope.workspaceId, date: new Date(after.date), isSynced: false, isFromFamily: false });
        await applyTransactionBudgetDelta(db, { nextBudgetId: after.budgetId, nextDirection: after.direction, nextAmountCents: after.amountCents });
        transactionId = tx.id;
      }
      state.savedTransactionId = transactionId;
      state.choices = [];
      state.pending = null;
      const balance = review.balances.find((b) => b.id === after.budgetId);
      const verb = after.direction === "DEBIT" ? "Deducted" : "Added";
      state.message = review.before
        ? "Correction saved. The original and its correction are kept in the history."
        : `Saved. ${verb} ${agentMoney(after.amountCents, currency)} ${after.direction === "DEBIT" ? "from" : "to"} ${balance?.name ?? "the sub-account"}${balance ? `, which now has ${agentMoney(balance.afterCents, currency)}` : ""}.`;
      if (state.intent.deferred) state.message += ` Next, you asked me to: “${state.intent.deferred}”.`;
      appendMessage(state, "assistant", state.message);
      const saved = await db.transactionAgentDraft.update({ where: { id: draft.id }, data: { status: "SAVED", stateJson: JSON.stringify(state) } });
      return transactionAgentView(saved);
    });
    return result.result;
  } catch (error) {
    if (!(error instanceof StaleReviewError)) throw error;
    // Nothing was written. Show the updated review so the person confirms what will actually happen.
    return advanceTransactionAgent(scope, { action: "refresh", draftId: draft.id, revision: input.revision, notice: "A balance changed since you reviewed this, so nothing was saved yet. I’ve updated the numbers." });
  }
}
