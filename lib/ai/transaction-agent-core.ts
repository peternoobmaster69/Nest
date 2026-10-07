import { getTransactionBudgetDelta } from "@/lib/budget-ledger";
import { scorePair } from "./entity-matching";
import {
  EMPTY_TRANSACTION_INTENT,
  type AgentBudget, type AgentChoice, type AgentEditField, type AgentReview, type AgentState, type AgentTransaction, type TransactionIntent,
} from "./transaction-agent-contracts";

/** How often each sub-account was used, overall or for transactions like this one. Ranking hints only. */
export type AgentUsage = { similar: Map<string, number>; recent: Map<string, number> };
export const EMPTY_USAGE: AgentUsage = { similar: new Map(), recent: new Map() };

export function normalizeAccountName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function parseAgentAmount(value: string | null): number | null {
  if (!value || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2_147_483_647 ? cents : null;
}

/** Accepts what people type into an amount box: "$12", "S$ 12.50", "12 dollars". */
export function parseTypedAmount(value: string): string | null {
  const match = /^(?:s\$|us\$|sgd|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:sgd|dollars?|bucks)?\.?$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function validAgentDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function agentToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function shiftAgentDate(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Relative words the server resolves itself. Anything else must already be YYYY-MM-DD. */
export function parseTypedDate(value: string, today: string): string | null {
  const text = value.trim().toLowerCase().replace(/[.!]$/, "");
  if (/^(?:today|just now|now)$/.test(text)) return today;
  if (/^(?:yesterday|yday|ytd)$/.test(text)) return shiftAgentDate(today, -1);
  if (/^(?:the )?day before yesterday$/.test(text)) return shiftAgentDate(today, -2);
  return validAgentDate(text) ? text : null;
}

function editDistance(left: string, right: string) {
  let row = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[right.length];
}

export function agentMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100);
}

type Ranked = { budget: AgentBudget; score: number; reason: string | null };
export type BudgetResolution =
  | { kind: "exact"; match: AgentBudget }
  | { kind: "ambiguous"; ranked: Ranked[] } // Same name in several bank accounts.
  | { kind: "suggest"; ranked: Ranked[] } // No exact name; these look close.
  | { kind: "none"; ranked: Ranked[] } // Nothing named (or nothing close): offer everything, most likely first.
  | { kind: "no-bank"; ranked: Ranked[] };

function usageReason(count: number, subject: string | null) {
  if (!count) return null;
  return subject ? `Used for ${count} similar transaction${count === 1 ? "" : "s"}` : `Used ${count} time${count === 1 ? "" : "s"} recently`;
}

/**
 * Resolves a spoken sub-account name. Only an exact (case/punctuation-insensitive) name in a single
 * bank account selects automatically. Near matches ("transport" vs "Transit"), model hints, and
 * history only order the choices the user must pick from.
 */
export function resolveAgentBudget(
  query: string | null,
  budgets: AgentBudget[],
  bankQuery: string | null = null,
  hints: { subject?: string | null; candidates?: string[]; usage?: AgentUsage } = {},
): BudgetResolution {
  const usage = hints.usage ?? EMPTY_USAGE;
  const bank = bankQuery ? normalizeAccountName(bankQuery) : null;
  const scoped = bank ? budgets.filter((b) => {
    const name = normalizeAccountName(b.accountName);
    return name.includes(bank) || bank.includes(name) || scorePair(bank, b.accountName).score >= 0.8;
  }) : budgets;
  const byLikelihood = (items: Ranked[]) => items.sort((a, b) => b.score - a.score
    || (usage.similar.get(b.budget.id) ?? 0) - (usage.similar.get(a.budget.id) ?? 0)
    || (usage.recent.get(b.budget.id) ?? 0) - (usage.recent.get(a.budget.id) ?? 0)
    || a.budget.name.localeCompare(b.budget.name) || a.budget.accountName.localeCompare(b.budget.accountName));
  const history = (b: AgentBudget) => {
    const similar = usage.similar.get(b.id) ?? 0;
    return { similar, reason: usageReason(similar || (usage.recent.get(b.id) ?? 0), similar ? hints.subject ?? "" : null) };
  };
  if (!scoped.length) return { kind: "no-bank", ranked: byLikelihood(budgets.map((budget) => ({ budget, score: 0, reason: null }))) };

  const candidateNames = new Set((hints.candidates ?? []).map(normalizeAccountName));
  const term = normalizeAccountName(query ?? "");
  if (term) {
    const exact = scoped.filter((b) => normalizeAccountName(b.name) === term);
    if (exact.length === 1) return { kind: "exact", match: exact[0] };
    if (exact.length > 1) return { kind: "ambiguous", ranked: byLikelihood(exact.map((budget) => ({ budget, score: 1, reason: budget.accountName }))) };
    const close = scoped.map((budget): Ranked => {
      const name = normalizeAccountName(budget.name);
      const pair = scorePair(term, budget.name);
      let score = pair.score;
      let reason: string | null = pair.method === "CONCEPT" ? "Similar category" : pair.score >= 0.8 ? "Similar name" : null;
      if (term.length >= 4 && editDistance(name, term) <= Math.max(1, Math.floor(term.length / 4)) && score < 0.85) { score = 0.85; reason = "Similar spelling"; }
      if (candidateNames.has(name) && score < 0.72) { score = 0.72; reason = "Possible match"; }
      const { similar, reason: used } = history(budget);
      if (score >= 0.6 && similar) { score += Math.min(0.1, similar / 100); reason = reason ?? used; }
      return { budget, score, reason };
    }).filter((item) => item.score >= 0.6);
    if (close.length) return { kind: "suggest", ranked: byLikelihood(close).slice(0, 6) };
  }
  // Nothing named: likely candidates (by history, category, or model hint) first, then everything else.
  return {
    kind: "none",
    ranked: byLikelihood(scoped.map((budget): Ranked => {
      const { similar, reason } = history(budget);
      const concept = hints.subject ? scorePair(hints.subject, budget.name) : null;
      const conceptual = concept && concept.score >= 0.8 ? 0.4 : 0;
      const hinted = candidateNames.has(normalizeAccountName(budget.name)) ? 0.3 : 0;
      const score = Math.min(0.9, (similar ? 0.5 + Math.min(0.3, similar / 20) : 0) + conceptual + hinted);
      return { budget, score, reason: reason ?? (conceptual ? "Similar category" : hinted ? "Possible match" : null) };
    })),
  };
}

function budgetChoice(item: Ranked, currency: string, suggested: boolean): AgentChoice {
  const detail = [item.budget.accountName, `${agentMoney(item.budget.availableCents, currency)} available`, suggested ? item.reason : null].filter(Boolean).join(" · ");
  return { kind: "budget", id: item.budget.id, label: item.budget.name, detail, suggested: suggested || undefined };
}

function describeAction(intent: TransactionIntent, currency: string) {
  const cents = parseAgentAmount(intent.amount);
  const amount = cents ? ` ${agentMoney(cents, currency)}` : "";
  if (intent.direction === "DEBIT") return `deduct${amount} from`;
  if (intent.direction === "CREDIT") return `add${amount} to`;
  return "use for this";
}

const quote = (value: string) => `“${value}”`;
function joinOr(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/** Only server records and validated slots can become a review. Model prose cannot approve it. */
export function planTransactionReview(
  state: AgentState, budgets: AgentBudget[], before: AgentTransaction | null, currency: string,
  today = agentToday(), usage: AgentUsage = EMPTY_USAGE,
): AgentState {
  const next: AgentState = { ...state, choices: [], review: null, pending: null };
  const intent = state.intent;
  if (intent.operation === "CANCEL") return { ...next, message: "Cancelled. No transaction was changed." };
  if (intent.operation === "UNSUPPORTED") return { ...next, message: intent.clarification || "I can record or correct one ordinary expense or deposit at a time. Transfers between sub-accounts, card payments, receivables, deleting, splitting, and recurring entries are on the Transactions page." };
  if (intent.operation === "CLARIFY" || intent.clarification) return { ...next, message: intent.clarification || "Would you like to record an expense, add money, or correct an existing transaction?" };
  if (intent.currency && intent.currency.toUpperCase() !== currency) return { ...next, pending: "amount", message: `This workspace uses ${currency}. What was the amount in ${currency}? I can’t convert currencies.` };
  if (intent.operation === "UPDATE" && !before) return { ...next, pending: "target", message: "Which transaction should I correct? Tell me its description, date, or original amount." };

  const eligibleBudgets = before ? budgets.filter((b) => b.accountId === before.accountId) : budgets;
  if (!eligibleBudgets.length) return { ...next, message: "There are no active sub-accounts available for this transaction. Add or activate one on the Budgets page first." };
  let budget = eligibleBudgets.find((b) => b.id === state.budgetId);
  if (!budget && !intent.accountQuery && before?.budgetId && !state.pickBudget) budget = eligibleBudgets.find((b) => b.id === before.budgetId);
  if (!budget) {
    const resolution = resolveAgentBudget(intent.accountQuery, eligibleBudgets, intent.bankQuery, { subject: intent.subject ?? before?.subject, candidates: intent.accountCandidates ?? [], usage });
    if (resolution.kind === "exact") budget = resolution.match;
    else {
      const action = describeAction(intent, currency);
      const said = intent.accountQuery ? quote(intent.accountQuery) : "";
      if (resolution.kind === "ambiguous") {
        next.message = `You have more than one sub-account named ${said}. Which bank account is it in?`;
        next.choices = resolution.ranked.map((item) => budgetChoice(item, currency, false));
      } else if (resolution.kind === "suggest") {
        const names = resolution.ranked.map((item) => quote(item.budget.name));
        next.message = resolution.ranked.length === 1
          ? `There’s no sub-account called ${said}. Did you mean ${names[0]}?`
          : `There’s no sub-account called ${said}. Did you mean ${joinOr(names.slice(0, 3))}?`;
        next.choices = resolution.ranked.map((item) => budgetChoice(item, currency, true));
      } else {
        const likely = resolution.ranked.filter((item) => item.score > 0);
        const intro = resolution.kind === "no-bank" ? `I couldn’t find a bank account matching ${quote(intent.bankQuery ?? "")}. ` : said ? `I couldn’t find a sub-account like ${said}. ` : "";
        next.message = `${intro}Which sub-account should I ${action}?${likely.length ? ` I’ve put the likeliest first, based on your history.` : ""}`;
        next.choices = resolution.ranked.map((item) => budgetChoice(item, currency, item.score > 0 && likely.indexOf(item) < 3));
      }
      next.pending = "budget";
      return withDeferred(next, intent);
    }
  }
  next.budgetId = budget.id;
  next.pickBudget = false;
  const amountCents = intent.amount !== null ? parseAgentAmount(intent.amount) : before?.amountCents;
  if (!amountCents) {
    const invalid = intent.amount !== null ? `I can’t use ${quote(intent.amount)} as an amount. ` : "";
    return withDeferred({ ...next, pending: "amount", message: `${invalid}How much, in ${currency}? For example 12 or 12.50.` }, intent);
  }
  const direction = intent.direction ?? before?.direction;
  if (!direction) return withDeferred({ ...next, pending: "direction", message: `Should I deduct ${agentMoney(amountCents, currency)} from ${budget.name}, or add it?` }, intent);
  const subject = intent.subject || before?.subject;
  if (!subject) return withDeferred({ ...next, pending: "subject", message: `What was it for? For example “${direction === "DEBIT" ? "bus fare" : "salary"}”. Reply “skip” to call it “${budget.name}”.` }, intent);
  const date = intent.date ?? before?.date.slice(0, 10) ?? today;
  if (!validAgentDate(date)) return withDeferred({ ...next, pending: "date", message: "Which date? Say today, yesterday, or a date like 2026-09-30." }, intent);
  const kind = before?.direction === direction
    ? before.kind as AgentReview["after"]["kind"] : direction === "DEBIT" ? "EXPENSE" : "INCOME";
  const after: AgentReview["after"] = { accountId: budget.accountId, budgetId: budget.id, subject, amountCents, direction, kind, date: before && intent.date === null ? before.date : `${date}T00:00:00.000Z` };
  if (before && Object.entries(after).every(([key, value]) => before[key as keyof AgentTransaction] === value)) {
    return { ...next, message: "That already matches the saved transaction. What would you like to change?" };
  }
  const deltas = getTransactionBudgetDelta({ previousBudgetId: before?.budgetId, previousDirection: before?.direction, previousAmountCents: before?.amountCents, nextBudgetId: budget.id, nextDirection: direction, nextAmountCents: amountCents });
  // Include both accounts, even for a zero balance delta, so changes invalidate the preview.
  const affectedIds = new Set([budget.id, ...(before?.budgetId ? [before.budgetId] : [])]);
  const balances = budgets.filter((b) => affectedIds.has(b.id)).map((b) => ({ ...b, afterCents: b.availableCents + (deltas.get(b.id) ?? 0) }));
  if (balances.length !== affectedIds.size) return { ...next, message: "The original sub-account is no longer active. Correct this transaction on the Transactions page." };
  if (balances.some((b) => b.afterCents > 2_147_483_647 || b.afterCents < -2_147_483_648)) return { ...next, pending: "amount", message: "That change would exceed the supported sub-account balance. Please use a smaller amount." };
  const warnings = balances.filter((b) => b.afterCents < 0).map((b) => `${b.name} will be overdrawn: ${agentMoney(b.afterCents, currency)}.`);
  if (!before && !intent.date) warnings.push(`Dated today, ${today}. Say “yesterday” or a date to change it.`);
  if (date > today) warnings.push("This date is in the future. Saving still changes the available balance immediately.");
  if (date < shiftAgentDate(today, -365)) warnings.push("This date is more than a year ago.");
  next.review = { operation: before ? "UPDATE" : "CREATE", currency, before, after, balances, warnings };
  next.message = before ? "Here’s the correction. Check it, then press Confirm to save it with its history." : "Here’s the transaction. Check it, then press Confirm to save.";
  return withDeferred(next, intent);
}

function withDeferred(state: AgentState, intent: TransactionIntent): AgentState {
  if (!intent.deferred) return state;
  return { ...state, message: `${state.message}\n\nOne at a time: after this one I’ll help with “${intent.deferred}”.` };
}

const CHANGE_WORDS = /\b(?:actually|instead|change|make it|make that|no[, ]|not|wrong|cancel|stop|undo|delete|also|and then|another)\b/i;
const DEBIT_WORDS = /^(?:deduct|deduct it|minus|subtract|expense|spent|spend|paid|out|debit|take (?:it )?out|withdraw(?:al)?|take)$/i;
const CREDIT_WORDS = /^(?:add|add it|plus|deposit|income|in|credit|top up|received|refund|put (?:it )?in)$/i;

/**
 * Answers the single question the assistant just asked without calling the model, when the reply is
 * obviously only that answer. Anything that might be a change of mind returns null for the model.
 */
export function applyPendingReply(state: AgentState, reply: string, today = agentToday(), budgetName: string | null = null): TransactionIntent | null {
  const text = reply.trim().replace(/\s+/g, " ");
  if (!state.pending || !text || text.length > 80 || CHANGE_WORDS.test(text)) return null;
  const intent = { ...state.intent, clarification: null };
  switch (state.pending) {
    case "amount": {
      const amount = parseTypedAmount(text);
      // We asked for the workspace currency, so a bare number answers in it.
      return amount ? { ...intent, amount, currency: /us\$|usd/i.test(text) ? "USD" : null } : null;
    }
    case "direction": {
      const word = text.toLowerCase().replace(/[.!]$/, "");
      if (DEBIT_WORDS.test(word)) return { ...intent, direction: "DEBIT" };
      if (CREDIT_WORDS.test(word)) return { ...intent, direction: "CREDIT" };
      return null;
    }
    case "date": {
      const date = parseTypedDate(text, today);
      return date ? { ...intent, date } : null;
    }
    case "subject": {
      if (/^(?:skip|none|no|nothing|n\/a|-)[.!]?$/i.test(text)) return budgetName ? { ...intent, subject: budgetName } : null;
      // Digits or currency suggest a new instruction ("$12 lunch"), not just a description.
      if (/[\d$]/.test(text) || text.split(" ").length > 8) return null;
      return { ...intent, subject: text.charAt(0).toUpperCase() + text.slice(1) };
    }
    default:
      return null;
  }
}

const FALLBACK_DEBIT = /\b(?:deduct(?:ed)?|subtract(?:ed)?|minus|spent|spend|paid|pay|bought|withdrew|withdraw|charged?|took)\b/i;
const FALLBACK_CREDIT = /\b(?:add(?:ed)?|deposit(?:ed)?|received|receive|got paid|top(?:ped)? up|refund(?:ed)?|put)\b/i;

/**
 * A deliberately narrow parser for simple one-line commands, used only when the AI service is
 * unavailable. It never handles corrections, and every result still goes through review.
 */
export function parseTransactionFallback(message: string, today = agentToday()): TransactionIntent | null {
  const text = message.trim().replace(/\s+/g, " ");
  if (/\b(?:change|update|edit|correct|fix|rename|undo|delete|remove|transfer|move)\b/i.test(text)) return null;
  const debit = FALLBACK_DEBIT.test(text);
  const credit = FALLBACK_CREDIT.test(text);
  if (debit === credit) return null;
  const amountMatch = /(?:s\$|sgd|\$)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:sgd|dollars?|bucks)\b/i.exec(text)
    ?? /\b(?:deduct|subtract|minus|spent|spend|paid|pay|withdrew|withdraw|took|add|deposit|received|put)\s+(\d[\d,]*(?:\.\d+)?)\b/i.exec(text);
  const amount = amountMatch ? amountMatch[1] ?? amountMatch[2] ?? null : null;
  if (!amount) return null;
  const stop = String.raw`(?=\s+(?:for|on|at|yesterday|today|from|to|into|in)\b|[.,!]|$)`;
  const account = new RegExp(String.raw`\b(?:from|to|into|in|under|out of)\s+(?:my\s+|the\s+)?([\p{L}][\p{L}\p{N} &'-]{0,40}?)(?:\s+(?:sub[- ]?account|account|budget|envelope))?${stop}`, "iu").exec(text);
  const subject = new RegExp(String.raw`\b(?:for|on)\s+(?!today\b|yesterday\b)([\p{L}][\p{L}\p{N} &'-]{0,60}?)${stop}`, "iu").exec(text);
  const date = /\byesterday\b/i.test(text) ? shiftAgentDate(today, -1) : /\btoday\b/i.test(text) ? today : null;
  return {
    ...EMPTY_TRANSACTION_INTENT,
    operation: "CREATE",
    amount,
    direction: debit ? "DEBIT" : "CREDIT",
    accountQuery: account?.[1]?.trim() ?? null,
    subject: subject?.[1] ? subject[1].charAt(0).toUpperCase() + subject[1].slice(1) : null,
    date,
    currency: /\bus\$|\busd\b/i.test(text) ? "USD" : null,
  };
}

export class AgentEditError extends Error {}

/** Applies a field edit from the review card. The planner revalidates the result. */
export function applyAgentEdit(state: AgentState, field: AgentEditField, value: string | undefined, today = agentToday()): AgentState {
  const intent = { ...state.intent, clarification: null };
  const raw = value?.trim() ?? "";
  switch (field) {
    case "budget":
      return { ...state, intent: { ...intent, accountQuery: null, bankQuery: null, accountCandidates: [] }, budgetId: null, pickBudget: true };
    case "amount": {
      const amount = parseTypedAmount(raw);
      if (!amount || !parseAgentAmount(amount)) throw new AgentEditError("Enter a positive amount with at most two decimal places.");
      return { ...state, intent: { ...intent, amount, currency: null } };
    }
    case "subject":
      if (!raw) throw new AgentEditError("Enter a description.");
      return { ...state, intent: { ...intent, subject: raw.slice(0, 120) } };
    case "date": {
      const date = parseTypedDate(raw, today);
      if (!date) throw new AgentEditError("Enter a date like 2026-09-30, today, or yesterday.");
      return { ...state, intent: { ...intent, date } };
    }
    case "direction":
      if (raw !== "DEBIT" && raw !== "CREDIT") throw new AgentEditError("Choose deduct or add.");
      return { ...state, intent: { ...intent, direction: raw } };
  }
}
