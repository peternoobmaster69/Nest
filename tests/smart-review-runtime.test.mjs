import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
const calls = [];
let state;
function record(method, args) {
  calls.push({ method, args });
  if (state.failure === method) throw new Error("Read unavailable");
}
const rows = (method, key) => async (args) => { record(method, args); return state[key]; };
const aggregate = (method) => async (args) => { record(method, args); return state.aggregate; };
const prisma = {
  workspace: { async findUnique(args) { record("workspace", args); return args.select.updatedAt ? state.fingerprintWorkspace : state.workspace; } },
  workspaceMember: {
    async findUnique(args) { record("membership", args); return args.select.role ? state.fingerprintMember : state.membership; },
    findMany: rows("cross-memberships", "crossMemberships"),
  },
  financialAccount: {
    aggregate: aggregate("account-count"),
    async findMany(args) { record("accounts", args); return typeof args.where.workspaceId === "string" ? state.accounts : state.crossAccounts; },
  },
  budgetEnvelope: { aggregate: aggregate("budget-count") },
  transaction: { aggregate: aggregate("ledger-count"), findMany: rows("categorized", "categorized") },
  creditCardTransaction: {
    aggregate: aggregate("history-count"),
    async findFirst(args) { record("fingerprint-transaction", args); return state.transactions.find((transaction) => transaction.id === args.where.id) ?? null; },
    async findMany(args) {
      record("card-transactions", args);
      if (args.where.id) return state.transactions.filter((transaction) => args.where.id.in.includes(transaction.id) && !transaction.isAllocated);
      return args.where.isAllocated ? state.history : state.related;
    },
  },
  postingGroup: { findMany: rows("postings", "postings") },
};
mock.module("../lib/prisma.ts", { namedExports: { prisma } });
mock.module("../lib/ai/config.ts", { namedExports: { getAiWorkloadClient() {
  record("client", null);
  return { model: "test-model", client: { responses: { async create(args) {
    record("model", args);
    if (state.modelError !== undefined) throw state.modelError;
    const input = JSON.parse(args.input);
    const suggestions = input.transactions.map((transaction) => ({
      transactionId: transaction.transactionId, normalizedMerchant: transaction.subject.slice(0, 80),
      candidateKey: "NO_MATCH", rationale: "NO_CLEAR_MATCH", ...state.modelSuggestion,
    }));
    return { status: "completed", output_text: JSON.stringify({ suggestions }), ...state.modelResponse };
  } } } };
} } });
mock.module("../lib/ai/agent-runtime.ts", { namedExports: {
  async getAgentConfiguration() { return state.configuration; },
  async getAgentTrainingExamples() { return []; },
} });
const { defaultAgentConfiguration } = require("../lib/ai/agent-catalog.ts");
const { reviewCreditCardTransactions: review, getSmartReviewFingerprint: fingerprint, isSmartReviewGeneratedAtFresh: fresh } = require("../lib/ai/smart-review.ts");
const now = new Date("2026-10-08T03:00:00Z");
const transaction = (id = "purchase", extra = {}) => ({
  id, workspaceId: "home", creditCardId: "visa", subject: "Acme Grocer", amountCents: 1_234,
  transactionDate: new Date("2026-10-07T00:00:00Z"), updatedAt: now, isAllocated: false,
  creditCard: { cardName: "Daily Visa" }, ledgerTransactions: [], ...extra,
});
const ledgerEntry = (direction, budgetId) => ({ id: `${direction}-${budgetId}`, direction, accountId: "bank", budgetId, account: { id: "bank", name: "Household bank" }, budget: { id: budgetId, name: budgetId === "food" ? "Groceries" : "Card settlement" } });
function history(count, { destination = true, subject = "Acme Grocer", budget = "food" } = {}) {
  return Array.from({ length: count }, (_, index) => transaction(`history-${index}`, {
    subject, isAllocated: true, ledgerTransactions: [ledgerEntry("DEBIT", budget), ...(destination ? [ledgerEntry("CREDIT", "card")] : [])],
  }));
}
const deductRule = { id: "food-rule", name: "Groceries rule", enabled: true, action: "DEDUCT_SAME_WORKSPACE", filters: ["acme"], sourceBudgetId: "food", destinationBudgetId: "card" };
const crossRule = { id: "family-rule", name: "Family expenses", enabled: true, action: "RECEIVABLE_OTHER_WORKSPACE", filters: ["acme"], sourceWorkspaceId: "family", sourceAccountId: "family-bank", sourceBudgetId: "family-food" };
function setRules(rules) { state.workspace.creditCardAutoRules = JSON.stringify(rules); }
const run = (ids = state.transactions.map(({ id }) => id)) => review({ workspaceId: "home", userId: "member", transactionIds: ids });
const queries = (method) => calls.filter((call) => call.method === method);
beforeEach((context) => {
  context.mock.timers.enable({ apis: ["Date"], now });
  context.mock.method(console, "warn", () => {});
  calls.length = 0;
  state = {
    configuration: defaultAgentConfiguration("smart-review"),
    workspace: { id: "home", name: "Household", creditCardAutoRules: null, receivableDefaultAccountId: "bank", receivableDefaultBudgetId: "card" },
    fingerprintWorkspace: { updatedAt: now }, membership: { id: "member-home" }, fingerprintMember: { role: "OWNER", createdAt: now },
    aggregate: { _count: { id: 0 }, _max: { updatedAt: null } },
    accounts: [{ id: "bank", name: "Household bank", budgets: [{ id: "food", name: "Groceries" }, { id: "card", name: "Card settlement" }] }],
    transactions: [transaction()], history: [], categorized: [], related: [], postings: [], crossMemberships: [], crossAccounts: [],
  };
});

test("review fingerprints detect changed transactions and workspace evidence without exposing their source values", async () => {
  const request = { workspaceId: "home", userId: "member", transactionId: "purchase" };
  const initial = await fingerprint(request);
  assert.match(initial, /^[a-f0-9]{64}$/);
  assert.equal(await fingerprint(request), initial);
  state.transactions[0].updatedAt = new Date(now.getTime() - 1);
  assert.notEqual(await fingerprint(request), initial);
  state.transactions[0].updatedAt = now;
  state.aggregate = { _count: { id: 3 }, _max: { updatedAt: now } };
  assert.notEqual(await fingerprint(request), initial);
  assert.deepEqual(queries("fingerprint-transaction")[0].args.where, { id: "purchase", workspaceId: "home" });
  assert.equal(await fingerprint({ ...request, transactionId: "unknown" }), null);
  state.fingerprintWorkspace = null;
  assert.equal(await fingerprint(request), null);
  state.fingerprintWorkspace = { updatedAt: now }; state.fingerprintMember = null;
  assert.equal(await fingerprint(request), null);
});

test("review timestamps enforce expiry and the allowed clock skew", () => {
  for (const offset of [-900_000, -1, 0, 60_000]) assert.equal(fresh(new Date(now.getTime() + offset).toISOString()), true);
  for (const offset of [-900_001, 60_001]) assert.equal(fresh(new Date(now.getTime() + offset).toISOString(), now.getTime()), false);
  assert.equal(fresh("invalid"), false);
});

test("review rejects unavailable membership or workspace evidence before requesting model assistance", async () => {
  for (const field of ["workspace", "membership", "fingerprintWorkspace", "fingerprintMember"]) {
    const original = state[field]; state[field] = null;
    await assert.rejects(run(), /workspace is unavailable/);
    state[field] = original;
  }
  state.configuration.enabled = false;
  await assert.rejects(run(), /paused by your administrator/);
  assert.equal(queries("model").length, 0);
});

test("existing rules outrank history, preserve request order, and offer approval without posting", async () => {
  setRules([{ ...deductRule, enabled: false }, deductRule]);
  state.transactions = [transaction("second"), transaction("first")];
  state.history = history(3, { budget: "other" });
  const result = await run(["first", "second", "unknown"]);
  assert.equal(result.providerStatus, "NOT_NEEDED");
  assert.equal(result.generatedAt, now.toISOString());
  assert.deepEqual(result.suggestions.map(({ transactionId }) => transactionId), ["first", "second"]);
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.action.budgetId, "food");
    assert.equal(suggestion.action.destinationBudgetId, "card");
    assert.equal(suggestion.confidence, "STRONG_MATCH");
    assert.equal(suggestion.canApprove, true);
    assert.deepEqual(suggestion.evidence, ["Matches the existing rule “Groceries rule”."]);
    assert.equal(suggestion.matchedRuleName, "Groceries rule");
    assert.equal(suggestion.ruleDraft, undefined);
  }
  const selected = queries("card-transactions").find(({ args }) => args.where.id).args.where;
  assert.deepEqual(selected, { workspaceId: "home", id: { in: ["first", "second", "unknown"] }, isAllocated: false });
  assert.equal(queries("model").length, 0);
});

test("consistent card history supports a reusable rule while a newly added destination requires review", async () => {
  state.history = history(5);
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.confidence, "STRONG_MATCH");
  assert.equal(suggestion.supportingCount, 5);
  assert.equal(suggestion.canApprove, true);
  assert.equal(suggestion.ruleDraft.recentMatchCount, 5);
  assert.equal(suggestion.ruleDraft.previewSubjects.length, 3);
  assert.equal(suggestion.ruleDraft.filter, "acme grocer");
  state.history = history(5, { destination: false });
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.equal(suggestion.action.destinationBudgetId, "card");
  assert.equal(suggestion.canApprove, false);
  assert.match(suggestion.evidence.join(" "), /would add a new credit path/);
  state.workspace.receivableDefaultBudgetId = null;
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action.destinationBudgetId, undefined);
  assert.equal(suggestion.canApprove, true);
  assert.equal(suggestion.ruleDraft, undefined);
});

test("categorized ledger history excludes inactive choices, the settlement budget, and unrelated merchants", async () => {
  state.categorized = [
    ...Array.from({ length: 3 }, () => ({ subject: "Acme Grocer", budgetId: "food" })),
    { subject: "Acme Grocer", budgetId: null }, { subject: "Acme Grocer", budgetId: "missing" },
    { subject: "Acme Grocer", budgetId: "card" }, { subject: "Different merchant", budgetId: "food" },
  ];
  const suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.supportingCount, 3);
  assert.equal(suggestion.action.budgetId, "food");
  assert.equal(suggestion.canApprove, true);
  assert.match(suggestion.evidence[0], /3 similar transactions were already categorized under Groceries/);
  assert.deepEqual(queries("categorized")[0].args.where, { workspaceId: "home", budgetId: { not: null }, direction: "DEBIT", voidedAt: null, reversalOfId: null, creditCardTransactionId: null });
});

test("explicit reimbursement language offers a receivable that still needs approval", async () => {
  state.transactions[0].subject = "Dinner reimbursement from family";
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action.type, "RECEIVABLE");
  assert.equal(suggestion.action.budgetId, "card");
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.equal(suggestion.canApprove, false);
  state.workspace.receivableDefaultBudgetId = null;
  suggestion = (await run()).suggestions[0];
  assert.deepEqual(suggestion.action, { type: "RECEIVABLE" });
  assert.equal(queries("model").length, 0);
});

test("cross-workspace rules reveal only budgets in workspaces the user can access", async () => {
  setRules([crossRule]);
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action, null);
  assert.equal(queries("accounts").filter(({ args }) => typeof args.where.workspaceId !== "string").length, 0);
  state.crossMemberships = [{ workspaceId: "family" }];
  state.crossAccounts = [{ id: "family-bank", name: "Family bank", workspaceId: "family", workspace: { name: "Family" }, budgets: [{ id: "family-food", name: "Shared groceries" }] }];
  suggestion = (await run()).suggestions[0];
  assert.deepEqual(suggestion.action, { type: "RECEIVABLE", sourceWorkspaceId: "family", sourceWorkspaceName: "Family", accountId: "family-bank", accountName: "Family bank", budgetId: "family-food", budgetName: "Shared groceries" });
  assert.equal(suggestion.canApprove, true);
  assert.deepEqual(queries("cross-memberships")[0].args.where, { userId: "member", workspaceId: { in: ["family"] } });
});

test("reversal and duplicate warnings prevent approval even when an existing rule matches", async () => {
  setRules([deductRule]);
  state.related = [transaction(), transaction("other-card", { creditCardId: "other" }), transaction("duplicate")];
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.state, "POSSIBLE_DUPLICATE");
  assert.equal(suggestion.relatedTransaction.id, "duplicate");
  assert.equal(suggestion.canApprove, false);
  state.related.push(transaction("refund", { amountCents: -1_234, transactionDate: new Date("2026-10-08T00:00:00Z") }));
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.state, "POSSIBLE_REVERSAL");
  assert.equal(suggestion.relatedTransaction.id, "refund");
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.match(suggestion.evidence[0], /opposite amount/);
});

test("model assistance uses allowlisted candidates and grounded names, and never enables approval", async () => {
  state.modelSuggestion = { candidateKey: "BUDGET:food", rationale: "MERCHANT_CATEGORY", normalizedMerchant: "Invented corporation" };
  const result = await run();
  const suggestion = result.suggestions[0];
  assert.equal(result.providerStatus, "READY");
  assert.equal(suggestion.generatedBy, "AI_ASSISTED");
  assert.equal(suggestion.normalizedMerchant, "Acme Grocer");
  assert.equal(suggestion.action.budgetId, "food");
  assert.equal(suggestion.action.destinationBudgetId, "card");
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.equal(suggestion.canApprove, false);
  const request = queries("model")[0].args;
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.match(request.safety_identifier, /^[a-f0-9]{32}$/);
  assert.deepEqual(JSON.parse(request.input).candidates.map(({ key }) => key), ["BUDGET:food", "RECEIVABLE", "NO_MATCH"]);
  state.modelSuggestion.candidateKey = "BUDGET:someone-elses-budget";
  assert.equal((await run()).suggestions[0].action, null);
});

test("model errors and incomplete responses leave transactions editable and do not invent evidence", async () => {
  for (const modelResponse of [{ status: "incomplete" }, { output_text: "invalid JSON" }, { output_text: '{"suggestions":[{}]}' }]) {
    state.modelResponse = modelResponse;
    const result = await run();
    assert.equal(result.providerStatus, "UNAVAILABLE");
    assert.equal(result.suggestions[0].action, null);
    assert.equal(result.suggestions[0].canApprove, false);
  }
  state.modelResponse = undefined;
  for (const error of [new Error("Private provider response"), "Private provider response"]) {
    state.modelError = error;
    assert.equal((await run()).providerStatus, "UNAVAILABLE");
  }
});

test("model batches are bounded and administrator capabilities also constrain deterministic suggestions", async () => {
  state.transactions = Array.from({ length: 40 }, (_, index) => transaction(`purchase-${index}`));
  let result = await run();
  assert.equal(result.providerStatus, "PARTIAL");
  assert.equal(JSON.parse(queries("model")[0].args.input).transactions.length, 32);
  assert.equal(result.suggestions.filter(({ generatedBy }) => generatedBy === "AI_ASSISTED").length, 32);
  setRules([deductRule]); state.configuration.capabilities = [];
  result = await run();
  assert.equal(result.providerStatus, "NOT_NEEDED");
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.action, null);
    assert.equal(suggestion.nameRecommendation, null);
    assert.equal(suggestion.ruleDraft, undefined);
    assert.equal(suggestion.canApprove, false);
    assert.equal(suggestion.confidence, "NO_RELIABLE_MATCH");
    assert.match(suggestion.evidence[0], /disabled by your administrator/);
  }
});

test("receivable history keeps optional source details and uses the latest posting for each transaction", async () => {
  state.history = history(3).map((row) => ({ ...row, ledgerTransactions: [] }));
  const source = {
    title: "Family lunch", sourceWorkspaceId: "family", sourceAccountId: "family-bank", sourceBudgetId: "family-food",
    account: { name: "Family bank" }, budget: { name: "Shared groceries" },
  };
  state.postings = [
    ...state.history.map(({ id }) => ({ sourceId: id, operation: "CREDIT_TRANSACTION_RECEIVABLE", receivables: [source] })),
    { sourceId: state.history[0].id, operation: "OTHER", receivables: [] },
    { sourceId: null, operation: "OTHER", receivables: [] },
  ];
  let suggestion = (await run()).suggestions[0];
  assert.deepEqual(suggestion.action, { type: "RECEIVABLE", sourceWorkspaceId: "family", accountId: "family-bank", accountName: "Family bank", budgetId: "family-food", budgetName: "Shared groceries" });
  assert.equal(suggestion.supportingCount, 3);
  assert.equal(suggestion.canApprove, true);
  assert.equal(suggestion.ruleDraft, undefined);
  assert.equal(queries("postings")[0].args.orderBy.createdAt, "desc");
  for (const receivables of [[], [{ title: "", sourceWorkspaceId: null, sourceAccountId: null, sourceBudgetId: null, account: null, budget: null }]]) {
    state.postings = state.history.map(({ id }) => ({ sourceId: id, operation: "CREDIT_TRANSACTION_RECEIVABLE", receivables }));
    suggestion = (await run()).suggestions[0];
    assert.deepEqual(suggestion.action, { type: "RECEIVABLE" });
    assert.equal(suggestion.supportingCount, 3);
  }
  state.postings = state.history.map(({ id }) => ({ sourceId: id, operation: "CREDIT_TRANSACTION_ACCOUNT", receivables: [source] }));
  assert.equal((await run()).suggestions[0].action.type, "RECEIVABLE");
});

test("marked, unallocated, and unrelated history do not establish an accounting path", async () => {
  state.history = [
    transaction("marked", { isAllocated: true }),
    transaction("legacy", { isAllocated: true, ledgerTransactions: [{ ...ledgerEntry("DEBIT", "food"), budget: null }] }),
    transaction("unallocated"),
    ...history(3, { subject: "Other merchant" }),
  ];
  state.postings = [{ sourceId: "legacy", operation: "CREDIT_TRANSACTION_ACCOUNT", receivables: [] }];
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action, null);
  assert.equal(suggestion.supportingCount, 0);
  state.postings = [{ sourceId: "legacy", operation: "CREDIT_TRANSACTION_MARK", receivables: [] }];
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action, null);
});

test("mixed and single card history remains reviewable while stronger ledger evidence wins", async () => {
  state.history = [...history(1), ...history(2, { budget: "other" }).map((row) => ({ ...row, id: `other-${row.id}` }))];
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action.budgetId, "other");
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.equal(suggestion.canApprove, false);
  state.history = history(1);
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.evidence[0], "1 similar accounted card transaction used this accounting path.");
  state.categorized = Array.from({ length: 3 }, () => ({ subject: "Acme Grocer", budgetId: "food" }));
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.confidence, "STRONG_MATCH");
  assert.match(suggestion.evidence[0], /already categorized/);
});

test("ledger candidates sort by support and a single match still requires review", async () => {
  state.accounts[0].budgets.push({ id: "other-food", name: "Household groceries" });
  state.categorized = [
    { subject: "Acme Grocer", budgetId: "other-food" },
    ...Array.from({ length: 3 }, () => ({ subject: "Acme Grocer", budgetId: "food" })),
  ];
  assert.equal((await run()).suggestions[0].action.budgetId, "food");
  state.categorized = [state.categorized[1]];
  state.workspace.receivableDefaultBudgetId = null;
  const suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.equal(suggestion.evidence[0], "1 similar transaction was already categorized under Groceries.");
  assert.equal(suggestion.action.destinationBudgetId, undefined);
});

test("specific budget names beat weak history while tied and partial names require review", async () => {
  state.accounts[0].budgets = [{ id: "similar", name: "Acme Grocer Express" }, { id: "exact", name: "Acme Grocer" }, state.accounts[0].budgets[1]];
  state.history = history(1);
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action.budgetId, "exact");
  assert.equal(suggestion.confidence, "STRONG_MATCH");
  assert.match(suggestion.evidence[0], /closely matches/);
  state.history = [];
  state.accounts[0].budgets[0].name = "Acme Grocer";
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  assert.equal(suggestion.canApprove, false);
  state.transactions[0].subject = "North Orchard City Market";
  state.accounts[0].budgets = [{ id: "market", name: "North City Market" }];
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action.budgetId, "market");
  assert.equal(suggestion.confidence, "NEEDS_REVIEW");
  state.transactions[0].subject = "North City Market";
  assert.equal((await run()).suggestions[0].confidence, "STRONG_MATCH");
});

test("rules with missing budgets or mismatched cross-workspace account IDs cannot approve spending", async () => {
  for (const change of [{ sourceBudgetId: "missing" }, { destinationBudgetId: "missing" }]) {
    setRules([{ ...deductRule, ...change }]);
    const suggestion = (await run()).suggestions[0];
    assert.equal(suggestion.action, null);
    assert.equal(suggestion.canApprove, false);
  }
  setRules([crossRule]);
  state.crossMemberships = [{ workspaceId: "family" }];
  state.crossAccounts = [{ id: "wrong-bank", name: "Family bank", workspaceId: "family", workspace: { name: "Family" }, budgets: [{ id: "family-food", name: "Shared groceries" }] }];
  assert.equal((await run()).suggestions[0].action, null);
});

test("refunds, zero amounts, and spending into the same destination never enable approval", async () => {
  setRules([deductRule]);
  for (const amountCents of [0, -1_234]) {
    state.transactions[0].amountCents = amountCents;
    assert.equal((await run()).suggestions[0].canApprove, false);
  }
  setRules([]);
  state.transactions[0].amountCents = 1_234;
  state.history = history(5, { budget: "card", destination: false });
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action.budgetId, "card");
  assert.equal(suggestion.action.destinationBudgetId, undefined);
  assert.equal(suggestion.canApprove, false);
  state.history = history(5, { budget: "card" });
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.ruleDraft, undefined);
  assert.equal(suggestion.canApprove, false);
});

test("short merchant filters and insufficient history cannot become reusable rules", async () => {
  state.transactions[0].subject = "BP";
  state.history = history(5, { subject: "BP" });
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.confidence, "STRONG_MATCH");
  assert.equal(suggestion.ruleDraft, undefined);
  state.transactions[0].subject = "Acme Grocer";
  state.history = history(4);
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.ruleDraft, undefined);
});

test("related transaction matching respects amount, merchant, and date boundaries", async () => {
  setRules([deductRule]);
  const relative = (days) => new Date(state.transactions[0].transactionDate.getTime() + days * 86_400_000);
  state.related = [
    transaction("other-amount", { amountCents: 4_000 }),
    transaction("different-refund", { amountCents: -4_000 }),
    transaction("old-duplicate", { transactionDate: relative(-4) }),
    transaction("old-refund", { amountCents: -1_234, transactionDate: relative(-46) }),
    transaction("different-merchant", { subject: "Other merchant" }),
    transaction("unrelated-refund", { amountCents: -1_234, subject: "Other merchant" }),
  ];
  assert.equal((await run()).suggestions[0].state, "UNACCOUNTED");
  state.related.push(transaction("boundary-duplicate", { transactionDate: relative(3) }));
  assert.equal((await run()).suggestions[0].state, "POSSIBLE_DUPLICATE");
  state.related.push(transaction("boundary-refund", { amountCents: -1_234, transactionDate: relative(45) }));
  assert.equal((await run()).suggestions[0].state, "POSSIBLE_REVERSAL");
  const query = queries("card-transactions").find(({ args }) => args.where.transactionDate).args.where;
  assert.equal(query.workspaceId, "home");
  assert.equal(query.transactionDate.gte.toISOString(), relative(-45).toISOString());
  assert.equal(query.transactionDate.lte.toISOString(), relative(45).toISOString());
});

test("empty requests avoid dependent posting, related-transaction, and model reads", async () => {
  state.transactions = [];
  assert.deepEqual(await run(), { suggestions: [], providerStatus: "NOT_NEEDED", generatedAt: now.toISOString() });
  assert.equal(queries("postings").length, 0);
  assert.equal(queries("card-transactions").filter(({ args }) => args.where.transactionDate).length, 0);
  assert.equal(queries("model").length, 0);
  state.failure = "accounts";
  await assert.rejects(run(), /Read unavailable/);
});

test("model receivables stay reviewable, unknown IDs are discarded, and merchant names stay grounded", async () => {
  state.modelSuggestion = { candidateKey: "RECEIVABLE", rationale: "RECEIVABLE_LANGUAGE", normalizedMerchant: "Acme" };
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.nameRecommendation, "Acme");
  assert.equal(suggestion.action.type, "RECEIVABLE");
  assert.equal(suggestion.canApprove, false);
  assert.match(suggestion.evidence[0], /confirm before creating/);
  state.workspace.receivableDefaultBudgetId = null;
  assert.deepEqual((await run()).suggestions[0].action, { type: "RECEIVABLE" });
  state.modelSuggestion.normalizedMerchant = "12345";
  assert.equal((await run()).suggestions[0].normalizedMerchant, "Acme Grocer");
  state.modelSuggestion.transactionId = "not-in-request";
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.generatedBy, "DETERMINISTIC");
  assert.equal(suggestion.action, null);
});

test("model assistance preserves duplicate warnings and deterministic matches in mixed batches", async () => {
  setRules([deductRule]);
  state.transactions.push(transaction("unknown", { subject: "Unfamiliar merchant" }));
  state.related = [transaction("possible-duplicate", { subject: "Unfamiliar merchant" })];
  state.modelSuggestion = { candidateKey: "BUDGET:food", rationale: "MERCHANT_CATEGORY" };
  const result = await run();
  assert.equal(result.suggestions[0].generatedBy, "DETERMINISTIC");
  assert.equal(result.suggestions[0].canApprove, true);
  assert.equal(result.suggestions[1].state, "POSSIBLE_DUPLICATE");
  assert.equal(result.suggestions[1].canApprove, false);
  assert.match(result.suggestions[1].evidence[0], /same card/);
});

test("disabled capabilities remove model candidates and deterministic receivable or rule suggestions", async () => {
  state.configuration.capabilities = [];
  state.modelSuggestion = { candidateKey: "RECEIVABLE", rationale: "RECEIVABLE_LANGUAGE", normalizedMerchant: "Acme" };
  let suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.nameRecommendation, null);
  assert.equal(suggestion.action, null);
  assert.deepEqual(JSON.parse(queries("model")[0].args.input).candidates.map(({ key }) => key), ["NO_MATCH"]);
  state.transactions[0].subject = "Dinner reimbursement";
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.action, null);
  assert.match(suggestion.evidence[0], /disabled by your administrator/);
  state.configuration = defaultAgentConfiguration("smart-review");
  state.configuration.capabilities = state.configuration.capabilities.filter((capability) => capability !== "rule-suggestions");
  state.transactions[0].subject = "Acme Grocer";
  state.history = history(5);
  suggestion = (await run()).suggestions[0];
  assert.equal(suggestion.canApprove, true);
  assert.equal(suggestion.ruleDraft, undefined);
});
