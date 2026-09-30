import assert from "node:assert/strict";
import test from "node:test";
import { AgentEditError, agentToday, applyAgentEdit, applyPendingReply, parseAgentAmount, parseTransactionFallback, parseTypedAmount, parseTypedDate, planTransactionReview, resolveAgentBudget, validAgentDate } from "../lib/ai/transaction-agent-core.ts";
import { EMPTY_TRANSACTION_INTENT, TransactionAgentRequestSchema, couldBeTransaction, isTransactionRequest } from "../lib/ai/transaction-agent-contracts.ts";

const budgets = [
  { id: "transit", name: "Transit", accountId: "bank", accountName: "DBS", availableCents: 10000 },
  { id: "food", name: "Food", accountId: "bank", accountName: "DBS", availableCents: 20000 },
];
const state = (intent = {}, overrides = {}) => ({ intent: { ...EMPTY_TRANSACTION_INTENT, operation: "CREATE", amount: "10", direction: "DEBIT", ...intent }, budgetId: null, transactionId: null, message: "", choices: [], review: null, messages: [], ...overrides });
const plan = (s, before = null, accounts = budgets) => planTransactionReview(s, accounts, before, "SGD", "2026-09-30");
const before = { id: "tx1", accountId: "bank", budgetId: "food", subject: "Lunch", amountCents: 1000, direction: "DEBIT", kind: "EXPENSE", date: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z", groupId: "trip", details: "original", notes: "keep" };

test("deduct $10 asks which sub-account and never produces a saveable review", () => {
  const result = plan(state());
  assert.equal(result.review, null);
  assert.match(result.message, /Which sub-account/);
  assert.deepEqual(result.choices.map((c) => c.id), ["food", "transit"], "alphabetical when there is no history");
  assert.match(result.choices[0].detail, /DBS/);
});

test("transport suggests Transit without selecting it; explicit Transit is exact", () => {
  const result = plan(state({ accountQuery: "transport", subject: "Bus fare" }));
  assert.equal(result.review, null);
  assert.equal(result.budgetId, null);
  assert.match(result.message, /Did you mean “Transit”/);
  assert.deepEqual(result.choices.map((c) => c.id), ["transit"]);
  const accepted = plan(state({ accountQuery: "transport", subject: "Bus fare" }, { budgetId: "transit" }));
  assert.equal(accepted.review.after.budgetId, "transit");
  assert.equal(resolveAgentBudget("TRANSIT", budgets).match.id, "transit");
  assert.equal(result.choices[0].suggested, true);
  assert.equal(result.pending, "budget");
});

test("unknown and duplicate names require choice; bank disambiguation is respected", () => {
  const unknown = resolveAgentBudget("Unknown", budgets);
  assert.equal(unknown.kind, "none");
  assert.equal(unknown.ranked.length, 2, "an unknown name still lists every sub-account");
  const duplicate = [...budgets, { ...budgets[0], id: "transit2", accountId: "bank2", accountName: "OCBC" }];
  const both = resolveAgentBudget("Transit", duplicate);
  assert.equal(both.kind, "ambiguous");
  assert.equal(both.ranked.length, 2);
  assert.equal(resolveAgentBudget("Transit", duplicate, "OCBC").match.id, "transit2");
  assert.equal(resolveAgentBudget("Transit", duplicate, "ocbc bank").match.id, "transit2");
  assert.equal(resolveAgentBudget("Transit", duplicate, "Missing bank").kind, "no-bank");
  assert.match(plan(state({ accountQuery: "Transit", bankQuery: "Missing bank", subject: "Bus" }), null, duplicate).message, /couldn’t find a bank account/);
});

test("near names are suggested but never auto-selected", () => {
  const accounts = [...budgets, { id: "groceries", name: "Groceries", accountId: "bank", accountName: "DBS", availableCents: 5000 }, { id: "ent", name: "Entertainment", accountId: "bank", accountName: "DBS", availableCents: 5000 }];
  for (const [query, expected] of [["transport", "transit"], ["mrt", "transit"], ["grocery", "groceries"], ["Grocerys", "groceries"], ["ntuc", "groceries"], ["makan", "food"], ["lunch", "food"], ["entertainmnt", "ent"]]) {
    const result = resolveAgentBudget(query, accounts);
    assert.equal(result.kind, "suggest", query);
    assert.equal(result.ranked[0].budget.id, expected, query);
    const planned = plan(state({ accountQuery: query, subject: "Thing" }), null, accounts);
    assert.equal(planned.review, null, `${query} must not auto-select`);
    assert.equal(planned.budgetId, null);
  }
  assert.match(plan(state({ accountQuery: "grocery", subject: "Milk" }), null, accounts).message, /Did you mean “Groceries”\?/);
});

test("usage history and model candidates order choices without selecting", () => {
  const usage = { similar: new Map([["food", 12]]), recent: new Map([["transit", 30]]) };
  const hinted = planTransactionReview(state({ subject: "Chicken rice" }), budgets, null, "SGD", "2026-09-30", usage);
  assert.equal(hinted.review, null);
  assert.equal(hinted.choices[0].id, "food");
  assert.equal(hinted.choices[0].suggested, true);
  assert.match(hinted.message, /likeliest first/);
  const candidates = plan(state({ subject: "Grab ride", accountCandidates: ["Transit"] }));
  assert.equal(candidates.choices[0].id, "transit");
  assert.equal(candidates.budgetId, null);
});

test("missing description, amount, direction, and dates are clarified", () => {
  const noSubject = plan(state({}, { budgetId: "transit" }));
  assert.match(noSubject.message, /What was it for/);
  assert.match(noSubject.message, /skip/);
  assert.equal(noSubject.pending, "subject");
  const noAmount = plan(state({ amount: null }, { budgetId: "transit" }));
  assert.match(noAmount.message, /How much/);
  assert.equal(noAmount.pending, "amount");
  assert.match(plan(state({ direction: null }, { budgetId: "transit" })).message, /deduct.*add/i);
  const badDate = plan(state({ subject: "Bus", date: "2026-02-30" }, { budgetId: "transit" }));
  assert.equal(badDate.review, null);
  assert.match(badDate.message, /Which date/);
  assert.equal(badDate.pending, "date");
});

test("money is validated in cents without rounding, sign inversion, or overflow", () => {
  for (const [input, expected] of [["10", 1000], ["0.01", 1], ["10.50", 1050], ["1,234.56", 123456], ["21474836.47", 2147483647]]) assert.equal(parseAgentAmount(input), expected);
  for (const input of ["-10", "0", "0.00", "1.005", "1e3", "1,23", "$10", "21474836.48", null, "Infinity"]) assert.equal(parseAgentAmount(input), null, String(input));
  assert.equal(agentToday(new Date("2026-09-30T17:00:00Z")), "2026-10-01");
  assert.equal(validAgentDate("2026-02-29"), false);
});

test("review shows deduction, deposit, negative balances, and explicit date defaults", () => {
  const debit = plan(state({ subject: "Bus fare" }, { budgetId: "transit" }));
  assert.equal(debit.review.after.amountCents, 1000);
  assert.equal(debit.review.balances[0].afterCents, 9000);
  assert.ok(debit.review.warnings.some((w) => /Dated today, 2026-09-30/.test(w)));
  const credit = plan(state({ subject: "Refund", direction: "CREDIT" }, { budgetId: "transit" }));
  assert.equal(credit.review.after.kind, "INCOME");
  assert.equal(credit.review.balances[0].afterCents, 11000);
  const overdrawn = plan(state({ subject: "Train", amount: "200", date: "2026-10-01" }, { budgetId: "transit" }));
  assert.equal(overdrawn.review.balances[0].afterCents, -10000);
  assert.ok(overdrawn.review.warnings.some((w) => /overdrawn/.test(w)));
  const old = plan(state({ subject: "Train", date: "2024-01-01" }, { budgetId: "transit" }));
  assert.ok(old.review.warnings.some((w) => /more than a year/.test(w)));
  assert.ok(overdrawn.review.warnings.some((w) => /future/.test(w)));
});

test("updates preserve unchanged fields and show only net balance impact", () => {
  const result = plan(state({ operation: "UPDATE", amount: "12", direction: null }), before);
  assert.equal(result.review.after.subject, "Lunch");
  assert.equal(result.review.after.date, before.date);
  assert.equal(result.review.before, before);
  assert.equal(result.review.balances[0].afterCents, 19800);
  const reassign = plan(state({ operation: "UPDATE", amount: null, direction: null, accountQuery: "Transit" }), before);
  assert.deepEqual(reassign.review.balances.map((b) => [b.id, b.afterCents]), [["transit", 9000], ["food", 21000]]);
  assert.equal(plan(state({ operation: "UPDATE", amount: null, direction: null }), before).review, null);
});

test("currency mismatch, unsupported actions, missing target, and cancellation cannot produce reviews", () => {
  for (const intent of [{ currency: "USD" }, { operation: "UNSUPPORTED" }, { operation: "CANCEL" }, { operation: "UPDATE" }, { clarification: "Which date did you mean?" }]) {
    assert.equal(plan(state({ subject: "Bus", accountQuery: "Transit", ...intent })).review, null);
  }
  assert.equal(plan(state({ subject: "Bus" }), null, []).review, null);
});

test("cross-bank reassignment cannot be proposed as a correction", () => {
  const result = plan(state({ operation: "UPDATE", accountQuery: "Other" }, { budgetId: "other" }), before, [...budgets, { ...budgets[0], id: "other", name: "Other", accountId: "bank2" }]);
  assert.equal(result.review, null);
  assert.ok(result.choices.every((choice) => choice.id !== "other"));
});

test("confirmation accepts only an existing draft revision, never caller-supplied financial fields", () => {
  assert.equal(TransactionAgentRequestSchema.safeParse({ action: "confirm", draftId: "draft", revision: 2 }).success, true);
  for (const additional of [{ amountCents: 100 }, { workspaceId: "other" }, { approved: true }, { review: {} }]) {
    assert.equal(TransactionAgentRequestSchema.safeParse({ action: "confirm", draftId: "draft", revision: 2, ...additional }).success, false);
  }
  assert.equal(TransactionAgentRequestSchema.safeParse({ action: "start", message: "x".repeat(601) }).success, false);
});

test("common transaction commands open drafting without hijacking analysis questions", () => {
  for (const text of ["deduct $10", "I spent $20 on lunch", "add 50 to savings", "change yesterday's lunch to $12", "record a bus fare", "Can you update my transaction?", "Paid $4.50 for kopi", "please log $30 grab ride", "Took $50 out of groceries", "Deduct $10?", "I want to add my salary", "Fix the lunch from yesterday, it was $12", "Got my salary, $3,000", "Move $50 from Food to Transit", "Delete the bus fare", "Make that $12"]) assert.equal(isTransactionRequest(text), true, text);
  for (const text of ["How much did I spend?", "Show my transactions", "What changed this month?", "Did I pay my card?", "How much did I spend on transport last month?", "List my sub-accounts", "What is my savings balance?", "Did I add my salary?", "Where did I spend the most?", "How much is left in transit?", "Did I move money to savings?"]) assert.equal(isTransactionRequest(text), false, text);
});

test("typed amounts and dates accept the ways people write them", () => {
  for (const [input, expected] of [["12", "12"], ["$12", "12"], ["S$ 12.50", "12.50"], ["12 dollars", "12"], ["sgd 1,200", "1,200"]]) assert.equal(parseTypedAmount(input), expected, input);
  for (const input of ["twelve-ish", "-5", "", "12 apples and 3 pears"]) assert.equal(parseTypedAmount(input), null, input);
  assert.equal(parseTypedDate("today", "2026-09-30"), "2026-09-30");
  assert.equal(parseTypedDate("Yesterday", "2026-09-30"), "2026-09-29");
  assert.equal(parseTypedDate("the day before yesterday", "2026-09-30"), "2026-09-28");
  assert.equal(parseTypedDate("2026-09-01", "2026-09-30"), "2026-09-01");
  assert.equal(parseTypedDate("2026-02-30", "2026-09-30"), null);
});

test("short answers fill the pending question without a model; changes of mind do not", () => {
  const ask = (pending, reply, intent = {}) => applyPendingReply(state(intent, { pending }), reply, "2026-09-30", "Transit");
  assert.equal(ask("amount", "12.50", { amount: null }).amount, "12.50");
  assert.equal(ask("amount", "$12", { amount: null }).amount, "12");
  assert.equal(ask("direction", "deduct", { direction: null }).direction, "DEBIT");
  assert.equal(ask("direction", "Add", { direction: null }).direction, "CREDIT");
  assert.equal(ask("date", "yesterday").date, "2026-09-29");
  assert.equal(ask("subject", "bus fare").subject, "Bus fare");
  assert.equal(ask("subject", "skip").subject, "Transit");
  for (const [pending, reply] of [["amount", "actually make it 12"], ["subject", "$12 lunch"], ["subject", "no, change it to food"], ["direction", "not sure"], ["budget", "transit"], [null, "12"], ["amount", "cancel"]]) {
    assert.equal(ask(pending, reply), null, `${pending}: ${reply}`);
  }
});

test("fallback parser handles simple commands only, and still needs review", () => {
  const simple = parseTransactionFallback("Deduct $10 from Transit for bus fare", "2026-09-30");
  assert.deepEqual([simple.operation, simple.amount, simple.direction, simple.accountQuery, simple.subject], ["CREATE", "10", "DEBIT", "Transit", "Bus fare"]);
  const lunch = parseTransactionFallback("Spent $12.50 on lunch at the hawker yesterday", "2026-09-30");
  assert.deepEqual([lunch.amount, lunch.subject, lunch.date, lunch.accountQuery], ["12.50", "Lunch", "2026-09-29", null]);
  const deposit = parseTransactionFallback("add 100 to savings", "2026-09-30");
  assert.deepEqual([deposit.direction, deposit.amount, deposit.accountQuery], ["CREDIT", "100", "savings"]);
  assert.equal(parseTransactionFallback("deduct $10", "2026-09-30").accountQuery, null);
  const took = parseTransactionFallback("Took $50 out of groceries", "2026-09-30");
  assert.deepEqual([took.direction, took.amount, took.accountQuery], ["DEBIT", "50", "groceries"]);
  for (const text of ["change lunch to $12", "delete the bus fare", "transfer $10 from food to transit", "hello", "deduct some money", "paid and added $5"]) assert.equal(parseTransactionFallback(text, "2026-09-30"), null, text);
  assert.equal(plan(state({ ...simple }, {})).review.after.budgetId, "transit", "the fallback result is planned like any other intent");
});

test("inline edits are deterministic and validated", () => {
  const base = state({ subject: "Bus", accountQuery: "Transit" }, { budgetId: "transit" });
  assert.equal(plan(applyAgentEdit(base, "amount", "S$12.50", "2026-09-30")).review.after.amountCents, 1250);
  assert.equal(plan(applyAgentEdit(base, "date", "yesterday", "2026-09-30")).review.after.date, "2026-09-29T00:00:00.000Z");
  assert.equal(plan(applyAgentEdit(base, "direction", "CREDIT")).review.after.direction, "CREDIT");
  assert.equal(plan(applyAgentEdit(base, "subject", "Train")).review.after.subject, "Train");
  const reopened = plan(applyAgentEdit(base, "budget"));
  assert.equal(reopened.review, null);
  assert.equal(reopened.pending, "budget");
  assert.equal(reopened.choices.length, 2, "changing the sub-account lists all of them");
  for (const [field, value] of [["amount", "0"], ["amount", "abc"], ["date", "someday"], ["direction", "SIDEWAYS"], ["subject", " "]]) {
    assert.throws(() => applyAgentEdit(base, field, value), AgentEditError, `${field}=${value}`);
  }
  assert.equal(TransactionAgentRequestSchema.safeParse({ action: "edit", draftId: "d", revision: 1, field: "amountCents", value: "1" }).success, false);
  assert.equal(TransactionAgentRequestSchema.safeParse({ action: "edit", draftId: "d", revision: 1, field: "amount", value: "12", budgetId: "x" }).success, false);
});

test("multiple requests are handled one at a time with a note about the rest", () => {
  const result = plan(state({ subject: "Lunch", accountQuery: "Food", deferred: "add $50 to savings" }));
  assert.ok(result.review);
  assert.match(result.message, /after this one I’ll help with “add \$50 to savings”/);
});

test("answers offer recording only for statements that carry an amount", () => {
  for (const text of ["Lunch $12 at the hawker centre", "grab 15 dollars", "S$30 taxi home"]) assert.equal(couldBeTransaction(text), true, text);
  for (const text of ["How much did I spend in 2025?", "Show spending over $100", "Top 5 merchants", "Compare March and April"]) assert.equal(couldBeTransaction(text), false, text);
});
