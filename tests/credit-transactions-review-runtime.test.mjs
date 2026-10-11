import assert from "node:assert/strict";
import test from "node:test";
import { createCreditTransactionsHarness, creditFixture, creditResponse, deductAction, suggestionFixture, deferred } from "./credit-transactions-page-harness.mjs";

const { ui, fixtures, invalidations, writes, client, holdRefetches, show, loaded, row } = await createCreditTransactionsHarness();
const reviews = suggestions => ({ suggestions, providerStatus: "READY", generatedAt: "2026-10-11T00:00:00.000Z" });
const configureReviews = suggestions => fixtures.set("POST /api/ai/smart-review", reviews(suggestions));
const openReview = async (view, subject = "Cafe") => {
  ui.fireEvent.click(view.getByRole("button", { name: "Review suggestions" }));
  return ui.within(await view.findByRole("article", { name: `Smart Review for ${subject}` }));
};
const ruleDraft = { name: "Cafe to card fund", filter: "CAFE", sourceBudgetId: "food", destinationBudgetId: "card-fund", recentMatchCount: 3, previewSubjects: ["Cafe brunch", "Cafe dinner"] };

test("Smart Review shows confidence, duplicate and reversal evidence, optional name suggestions and accounting effects", async () => {
  const suggestions = [
    suggestionFixture({ nameRecommendation: "Cafe Limited", state: "POSSIBLE_DUPLICATE", action: deductAction({ destinationBudgetName: "Card fund", destinationBudgetId: "card-fund" }), relatedTransaction: { id: "prior", subject: "Prior cafe", transactionDate: "2026-10-09T00:00:00Z", isAllocated: true } }),
    suggestionFixture({ transactionId: "reversal", state: "POSSIBLE_REVERSAL", confidence: "NEEDS_REVIEW", canApprove: false, action: { type: "RECEIVABLE", budgetName: "Family food" } }),
    suggestionFixture({ transactionId: "unmatched", confidence: "NO_RELIABLE_MATCH", canApprove: false, action: null }),
  ];
  configureReviews(suggestions);
  fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture(), creditFixture({ id: "reversal", subject: "Reversal" }), creditFixture({ id: "unmatched", subject: "Unknown merchant" })]));
  const view = show();
  await loaded(view);
  const card = await openReview(view);
  for (const text of ["Strong match", "Cafe Limited", "Check possible duplicate", "Matched prior accounting"])
    assert.ok(card.getByText(text));
  assert.ok(card.getByText(/Related: 9 Oct · Prior cafe/));
  assert.ok(card.getByText(/deducted from Food and credited to Card fund/));
  const reversal = ui.within(view.getByRole("article", { name: "Smart Review for Reversal" }));
  assert.ok(reversal.getByText("Needs review"));
  assert.ok(reversal.getByText("Check possible reversal"));
  assert.ok(reversal.getByText(/recorded as a receivable/));
  assert.ok(!reversal.queryByRole("button", { name: "Approve", exact: true }));
  const unmatched = ui.within(view.getByRole("article", { name: "Smart Review for Unknown merchant" }));
  assert.ok(unmatched.getByText("No reliable match"));
  assert.ok(unmatched.getByText("No accounting action suggested"));
  assert.ok(view.getByText("1 ready to approve · 1 needs a closer look · 1 needs a category"));
  ui.fireEvent.click(unmatched.getByRole("button", { name: "Deduct", exact: true }));
  let dialog = await view.findByRole("dialog", { name: "Account for transaction" });
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Cancel" }));
  ui.fireEvent.click(unmatched.getByRole("button", { name: "Create receivable", exact: true }));
  dialog = await view.findByRole("dialog", { name: "Create receivable" });
  ui.fireEvent.click(ui.within(dialog).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(writes(), []);
});

test("Smart Review failures can be refreshed, and individual or global dismissals never change the ledger", async () => {
  fixtures.set("POST /api/ai/smart-review", Response.json({ error: "Provider unavailable" }, { status: 503 }));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Review suggestions" }));
  await view.findByText("Suggestions could not load. The normal accounting controls still work.");
  configureReviews([suggestionFixture()]);
  ui.fireEvent.click(view.getByRole("button", { name: "Refresh Smart Review suggestions" }));
  let card = ui.within(await view.findByRole("article", { name: "Smart Review for Cafe" }));
  ui.fireEvent.click(card.getByRole("button", { name: "Dismiss", exact: true }));
  await view.findByText("All suggestions dismissed.");
  assert.ok(!view.queryByRole("article"));
  fixtures.set("POST /api/ai/smart-review", { ...reviews([suggestionFixture()]), generatedAt: "2026-10-11T00:01:00.000Z" });
  ui.fireEvent.click(view.getByRole("button", { name: "Refresh Smart Review suggestions" }));
  card = ui.within(await view.findByRole("article", { name: "Smart Review for Cafe" }));
  assert.ok(card.getByRole("button", { name: "Approve", exact: true }));
  ui.fireEvent.click(view.getByRole("button", { name: "Dismiss all" }));
  await view.findByText("All suggestions dismissed.");
  configureReviews([]);
  ui.fireEvent.click(view.getByRole("button", { name: "Refresh Smart Review suggestions" }));
  await view.findByText("You’re all caught up.");
  assert.equal(view.getByRole("button", { name: "Dismiss all" }).disabled, true);
  ui.fireEvent.click(view.getByRole("button", { name: "Review suggestions" }));
  assert.ok(!view.queryByText("Smart Review"));
  assert.deepEqual(writes(), []);
});

test("Smart Review has an explicit empty state when every visible transaction is accounted", async () => {
  fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ isAllocated: true })]));
  const view = show();
  await loaded(view);
  ui.fireEvent.click(view.getByRole("button", { name: "Review suggestions" }));
  assert.ok(view.getByText("No visible unaccounted transactions to review."));
  assert.equal(view.getByRole("button", { name: "Refresh Smart Review suggestions" }).disabled, true);
  assert.ok(!view.queryByRole("article"));
});

test("name recommendations preserve the current revision, disable concurrent approval, and update the displayed record", async t => {
  const pending = deferred();
  const updated = creditFixture({ subject: "Cafe Limited" });
  t.after(() => pending.resolve(Response.json(updated)));
  configureReviews([suggestionFixture({ nameRecommendation: "Cafe Limited" })]);
  fixtures.set("PATCH /api/credit-transactions/cafe", () => pending.promise);
  holdRefetches();
  const view = show();
  await loaded(view);
  const card = await openReview(view);
  ui.fireEvent.click(card.getByRole("button", { name: "Update name" }));
  await ui.waitFor(() => assert.equal(writes().length, 1));
  assert.equal(card.getByRole("button", { name: "Updating…" }).disabled, true);
  assert.equal(card.getByRole("button", { name: "Approve", exact: true }).disabled, true);
  assert.deepEqual(writes()[0].body, { subject: "Cafe Limited", expectedUpdatedAt: creditFixture().updatedAt });
  await ui.act(async () => pending.resolve(Response.json(updated)));
  await view.findByText("Transaction name updated to “Cafe Limited”.");
  assert.ok(row(view, "Cafe Limited"));
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "smart-review"));
});

for (const [failure, message] of [
  [Response.json({ error: "Name update rejected" }, { status: 409 }), "Name update rejected"],
  [() => Promise.reject("disconnected"), "Failed to update the transaction name."],
]) {
  test(`failed name recommendations retain the transaction and show ${message}`, async () => {
    configureReviews([suggestionFixture({ nameRecommendation: "Cafe Limited" })]);
    fixtures.set("PATCH /api/credit-transactions/cafe", failure);
    const view = show();
    await loaded(view);
    const card = await openReview(view);
    ui.fireEvent.click(card.getByRole("button", { name: "Update name" }));
    await view.findByText(message);
    assert.ok(row(view));
    assert.equal(card.getByRole("button", { name: "Update name" }).disabled, false);
  });
}

test("deduction review opens the suggested source and destination for inspection without posting it", async () => {
  configureReviews([suggestionFixture({ action: deductAction({ accountId: "bank-joint", budgetId: "travel", destinationAccountId: "bank-home", destinationBudgetId: "card-fund" }) })]);
  const view = show();
  await loaded(view);
  const card = await openReview(view);
  ui.fireEvent.click(card.getByRole("button", { name: "Review & apply" }));
  const form = ui.within(await view.findByRole("dialog", { name: "Account for transaction" }));
  assert.equal(form.getByLabelText("Bank Account").value, "bank-joint");
  assert.equal(form.getByLabelText("Sub Account").value, "travel");
  assert.equal(form.getByLabelText("Destination Account").value, "bank-home");
  assert.equal(form.getByLabelText("Destination Sub Account").value, "card-fund");
  assert.deepEqual(writes(), []);
});

for (const action of [
  { type: "RECEIVABLE" },
  { type: "RECEIVABLE", sourceWorkspaceId: "household", budgetName: "Card fund" },
  { type: "RECEIVABLE", sourceWorkspaceId: "shared", accountId: "bank-joint", budgetId: "travel" },
]) {
  test(`receivable review chooses the intended workspace (${action.sourceWorkspaceId ?? "default"})`, async () => {
    configureReviews([suggestionFixture({ action })]);
    const view = show();
    await loaded(view);
    const card = await openReview(view);
    assert.ok(card.getByText(action.budgetName ? `Create receivable · ${action.budgetName}` : "Create receivable"));
    ui.fireEvent.click(card.getByRole("button", { name: "Review & apply" }));
    const form = ui.within(await view.findByRole("dialog", { name: "Create receivable" }));
    assert.equal(form.getByRole("checkbox", { name: "Deduct from another workspace" }).checked, action.sourceWorkspaceId === "shared");
    if (action.sourceWorkspaceId === "shared") {
      await form.findByRole("option", { name: "Travel" });
      assert.equal(form.getByLabelText("Deduction Workspace").value, "shared");
      assert.equal(form.getByLabelText("Bank Account").value, "bank-joint");
      assert.equal(form.getByLabelText("Sub Account").value, "travel");
    }
    assert.deepEqual(writes(), []);
  });
}

for (const merchant of ["Cafe Limited", ""]) {
  test(`receivable approval preserves the review fingerprint and uses ${merchant || "the original subject"}`, async () => {
    configureReviews([suggestionFixture({ action: { type: "RECEIVABLE", accountId: "bank-home", budgetId: "card-fund" }, normalizedMerchant: merchant })]);
    fixtures.set("POST /api/credit-transactions/cafe/accounting", { ok: true });
    holdRefetches();
    const view = show();
    await loaded(view);
    const card = await openReview(view);
    ui.fireEvent.click(card.getByRole("button", { name: "Approve", exact: true }));
    await view.findByText("Receivable created and credit transaction marked accounted.");
    assert.deepEqual(writes()[0].body, { id: "cafe", action: "RECEIVABLE", receivableDate: "2026-10-31T00:00:00.000Z", transactionDate: creditFixture().transactionDate, title: merchant || "Cafe", amountCents: 1200, accountId: "bank-home", budgetId: "card-fund", smartReviewFingerprint: "trusted-fingerprint", smartReviewGeneratedAt: "2026-10-11T00:00:00.000Z" });
    assert.equal(row(view).getByRole("checkbox").disabled, true);
  });
}

test("receivable approval refuses a nonpositive charge even if the provider marks it approvable", async () => {
  configureReviews([suggestionFixture({ action: { type: "RECEIVABLE" } })]);
  fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ amountCents: -1200 })]));
  const view = show();
  await loaded(view);
  const card = await openReview(view);
  ui.fireEvent.click(card.getByRole("button", { name: "Approve", exact: true }));
  assert.deepEqual(writes(), []);
});

const approveWithRule = async (draft = ruleDraft) => {
  configureReviews([suggestionFixture({ ruleDraft: draft })]);
  fixtures.set("POST /api/credit-transactions/cafe/accounting", { ok: true });
  holdRefetches();
  const view = show();
  await loaded(view);
  const card = await openReview(view);
  ui.fireEvent.click(card.getByRole("button", { name: "Approve", exact: true }));
  await view.findByRole("region", { name: "Suggested auto-accounting rule" });
  return view;
};

test("approved accounting proposes an optional rule whose examples can be reviewed or cancelled before saving", async () => {
  fixtures.set("GET /api/credit-transactions/auto-rules", { workspaceId: "household", rules: [{ id: "existing", filters: ["BUS"] }] });
  fixtures.set("PUT /api/credit-transactions/auto-rules", { ok: true });
  const view = await approveWithRule();
  assert.ok(!Object.hasOwn(writes()[0].body, "ruleDraft"));
  assert.equal(writes()[0].body.smartReviewFingerprint, "trusted-fingerprint");
  ui.fireEvent.click(view.getByRole("button", { name: "Preview & create" }));
  let confirm = await view.findByRole("dialog", { name: "Create auto-accounting rule?" });
  assert.ok(ui.within(confirm).getByText(/3 recent transactions.*Cafe brunch; Cafe dinner/));
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Not Now" }));
  assert.equal(writes().length, 1);
  ui.fireEvent.click(view.getByRole("button", { name: "Preview & create" }));
  confirm = await view.findByRole("dialog", { name: "Create auto-accounting rule?" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Create Rule", exact: true }));
  await view.findByText("Auto-accounting rule created.");
  const ruleWrite = writes().find(({ method }) => method === "PUT");
  assert.equal(ruleWrite.body.workspaceId, "household");
  assert.deepEqual(ruleWrite.body.rules[0], { id: "existing", filters: ["BUS"] });
  const { id, ...created } = ruleWrite.body.rules[1];
  assert.match(id, /^[a-f\d-]{36}$/);
  assert.deepEqual(created, { name: ruleDraft.name, enabled: true, action: "DEDUCT_SAME_WORKSPACE", filters: ["CAFE"], sourceBudgetId: "food", destinationBudgetId: "card-fund" });
  assert.ok(!view.queryByRole("region", { name: "Suggested auto-accounting rule" }));
});

test("matching rules are detected case-insensitively without adding a duplicate", async () => {
  fixtures.set("GET /api/credit-transactions/auto-rules", { workspaceId: "household", rules: [{ filters: null }, { filters: [10, " cafe "] }] });
  const view = await approveWithRule({ ...ruleDraft, recentMatchCount: 1, previewSubjects: [] });
  ui.fireEvent.click(view.getByRole("button", { name: "Preview & create" }));
  const confirm = await view.findByRole("dialog", { name: "Create auto-accounting rule?" });
  assert.ok(ui.within(confirm).getByText(/1 recent transaction\./));
  assert.ok(!ui.within(confirm).queryByText(/Recent examples:/));
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Create Rule", exact: true }));
  await view.findByText("A matching auto-accounting rule already exists.");
  assert.equal(writes().length, 1);
});

test("a suggested rule can be dismissed without reading or saving the rule collection", async () => {
  const view = await approveWithRule();
  ui.fireEvent.click(view.getByRole("button", { name: "Not now", exact: true }));
  assert.ok(!view.queryByRole("region", { name: "Suggested auto-accounting rule" }));
  assert.equal(writes().length, 1);
});

test("a lost workspace prevents saving a suggested rule after the earlier accounting operation", async () => {
  const view = await approveWithRule();
  await ui.act(async () => client().setQueryData(["app-context", "household"], { workspaceId: null }));
  await view.findByText("Default Subaccount");
  ui.fireEvent.click(view.getByRole("button", { name: "Preview & create" }));
  const confirm = await view.findByRole("dialog", { name: "Create auto-accounting rule?" });
  ui.fireEvent.click(ui.within(confirm).getByRole("button", { name: "Create Rule", exact: true }));
  await view.findByText("Workspace is unavailable.");
  assert.equal(writes().length, 1);
});
