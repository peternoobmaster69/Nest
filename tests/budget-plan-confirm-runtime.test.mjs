import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { calls, dataCalls, given, require, state } from "./finance-route-harness.mjs";

const { confirmMonthlyBudget } = require("../lib/domains/ledger/budget-plan/confirm-service.ts");
const now = new Date("2026-10-10T12:00:00.000Z");
beforeEach(t => t.mock.timers.enable({ apis: ["Date"], now }));
const input = (values = {}) => ({ action: "confirmMonthly", workspaceId: "home", planId: "plan", applyToSubAccounts: true, ...values });
const confirm = (values = {}) => confirmMonthlyBudget({ workspaceId: "home", userId: "editor", idempotencyKey: "confirm-once", input: input(values) });
const plan = (values = {}) => ({
  id: "plan", workspaceId: "home", status: "CONFIRMING", month: 10, year: 2026,
  sources: [{ id: "salary", ownerId: "editor", amountCents: 10000 }],
  items: [{ id: "rent", title: "Rent", amountCents: 10000, appliedCents: 0, destinationSubAccountId: "envelope" }],
  ...values,
});
function givenClaim(currentPlan = plan()) {
  given("monthlyBudgetPlan.updateMany", { count: 1 });
  given("monthlyBudgetPlan.findFirstOrThrow", currentPlan);
}
function givenValidReferences() {
  given("workspaceMember.findMany", [{ userId: "editor" }]);
  given("budgetEnvelope.findMany", [{ id: "envelope", accountId: "bank" }]);
}
function givenFinalPlan(currentPlan) {
  const confirmed = { ...currentPlan, status: "CONFIRMED", confirmedAt: now };
  given("monthlyBudgetPlan.update", confirmed);
  given("monthlyBudgetPlan.findUniqueOrThrow", confirmed);
  return confirmed;
}
function assertNoFunding() {
  for (const name of ["monthlyBudgetPlanItem.update", "budgetEnvelope.update", "transaction.createMany", "monthlyBudgetPlan.update"]) assert.deepEqual(dataCalls(name), [], name);
}
function assertPostingBoundary() {
  assert.deepEqual(dataCalls("posting")[0], {
    workspaceId: "home", operation: "MONTHLY_BUDGET_CONFIRM", idempotencyKey: "confirm-once",
    actorUserId: "editor", sourceType: "MONTHLY_BUDGET_PLAN", sourceId: "plan", request: input(),
  });
  assert.ok(calls.filter(call => call.name !== "posting").every(call => call.inPosting), "all confirmation reads and writes belong to the posting transaction");
}

for (const [current, status] of [[null, 404], [plan({ status: "REVIEW" }), 409], [plan({ status: "CONFIRMING" }), 409]]) {
  test(`an unclaimable ${current?.status ?? "missing"} plan cannot be funded`, async () => {
    given("monthlyBudgetPlan.updateMany", { count: 0 });
    given("monthlyBudgetPlan.findFirst", current);
    await assert.rejects(confirm(), error => error.status === status);
    assert.deepEqual(dataCalls("monthlyBudgetPlan.updateMany"), [{ where: { id: "plan", workspaceId: "home", status: "DRAFT" }, data: { status: "CONFIRMING" } }]);
    assert.deepEqual(dataCalls("monthlyBudgetPlan.findFirst")[0].where, { id: "plan", workspaceId: "home" });
    assertNoFunding();
    assertPostingBoundary();
  });
}

for (const appliedCents of [0, 4000]) {
  test(`a confirmed plan reports existing funding (${appliedCents}) without applying it again`, async () => {
    const current = plan({ status: "CONFIRMED", items: [{ id: "rent", amountCents: 10000, appliedCents }] });
    given("monthlyBudgetPlan.updateMany", { count: 0 });
    given("monthlyBudgetPlan.findFirst", current);
    assert.deepEqual(await confirm(), { monthlyPlan: current, appliedCents: 0, appliedToSubAccounts: appliedCents > 0, postingGroupId: "posting-group", replayed: false });
    assertNoFunding();
    assert.deepEqual(dataCalls("workspaceMember.findMany"), []);
  });
}

test("an idempotent replay returns the original posting without re-reading or changing the plan", async () => {
  const saved = { monthlyPlan: plan({ status: "CONFIRMED" }), appliedCents: 10000, appliedToSubAccounts: true };
  state.replayedPosting = { result: saved, postingGroupId: "original-posting", replayed: true };
  assert.deepEqual(await confirm(), { ...saved, postingGroupId: "original-posting", replayed: true });
  assert.deepEqual(calls.map(call => call.name), ["posting"]);
});

for (const emptySide of ["sources", "items"]) {
  test(`a draft with no ${emptySide} cannot be confirmed even when totals are zero`, async () => {
    givenClaim(plan({ [emptySide]: [] }));
    await assert.rejects(confirm(), error => error.status === 400 && /at least one source and one budget item/.test(error.message));
    assertNoFunding();
    assert.deepEqual(dataCalls("workspaceMember.findMany"), []);
  });
}

test("unbalanced plans report both totals before looking up destinations or changing balances", async () => {
  givenClaim(plan({ sources: [{ ownerId: "editor", amountCents: 9999 }] }));
  await assert.rejects(confirm(), error => error.status === 400 && error.message === "Budget source total (9999) must equal budget item total (10000).");
  assertNoFunding();
  assert.deepEqual(dataCalls("workspaceMember.findMany"), []);
});

test("confirmation revalidates source owners inside the posting transaction", async () => {
  givenClaim();
  given("workspaceMember.findMany", []);
  given("budgetEnvelope.findMany", [{ id: "envelope", accountId: "bank" }]);
  await assert.rejects(confirm(), error => error.status === 400 && /owner outside this workspace/.test(error.message));
  assert.deepEqual(dataCalls("workspaceMember.findMany")[0].where, { workspaceId: "home", userId: { in: ["editor"] } });
  assertNoFunding();
  assertPostingBoundary();
});

for (const applyToSubAccounts of [false, true]) {
  test(`confirmation rejects ${applyToSubAccounts ? "inactive or foreign" : "foreign"} destinations`, async () => {
    givenClaim();
    given("workspaceMember.findMany", [{ userId: "editor" }]);
    given("budgetEnvelope.findMany", []);
    await assert.rejects(confirm({ applyToSubAccounts }), error => error.status === 400 && error.message === (applyToSubAccounts
      ? "A monthly budget item has an inactive or invalid destination sub-account."
      : "A monthly budget item has a destination outside this workspace."));
    assert.deepEqual(dataCalls("budgetEnvelope.findMany")[0].where, { workspaceId: "home", id: { in: ["envelope"] }, ...(applyToSubAccounts ? { isActive: true } : {}) });
    assertNoFunding();
  });
}

test("confirmation without funding verifies references and only marks the plan confirmed", async () => {
  const current = plan();
  givenClaim(current);
  givenValidReferences();
  const confirmed = givenFinalPlan(current);
  assert.deepEqual(await confirm({ applyToSubAccounts: false }), { monthlyPlan: confirmed, appliedCents: 0, appliedToSubAccounts: false, postingGroupId: "posting-group", replayed: false });
  assert.deepEqual(dataCalls("budgetEnvelope.update"), []);
  assert.deepEqual(dataCalls("monthlyBudgetPlanItem.update"), []);
  assert.deepEqual(dataCalls("transaction.createMany"), []);
  assert.deepEqual(dataCalls("monthlyBudgetPlan.update"), [{ where: { id: "plan" }, data: { status: "CONFIRMED", confirmedAt: now } }]);
});

test("items without a destination can be confirmed without performing a destination query or a balance write", async () => {
  const current = plan({ items: [{ id: "cash", title: "Cash", amountCents: 10000, appliedCents: 0, destinationSubAccountId: null }] });
  givenClaim(current);
  given("workspaceMember.findMany", [{ userId: "editor" }]);
  givenFinalPlan(current);
  const result = await confirm();
  assert.equal(result.appliedCents, 0);
  assert.equal(result.appliedToSubAccounts, true);
  assert.deepEqual(dataCalls("budgetEnvelope.findMany"), []);
  assert.deepEqual(dataCalls("transaction.createMany"), []);
  assert.deepEqual(dataCalls("monthlyBudgetPlanItem.update"), []);
});

test("fully applied drafts create no empty ledger batch and do not increment balances", async () => {
  const current = plan({ items: [{ id: "rent", title: "Rent", amountCents: 10000, appliedCents: 10000, destinationSubAccountId: "envelope" }] });
  givenClaim(current);
  givenValidReferences();
  givenFinalPlan(current);
  assert.equal((await confirm()).appliedCents, 0);
  assert.deepEqual(dataCalls("transaction.createMany"), []);
  assert.deepEqual(dataCalls("budgetEnvelope.update"), []);
});

test("confirmation applies only unpaid portions, combines shared destinations, and records stable ledger references", async () => {
  const current = plan({
    sources: [{ id: "salary", ownerId: "editor", amountCents: 7000 }, { id: "other-income", ownerId: "editor", amountCents: 4000 }],
    items: [
      { id: "food", title: "Food", amountCents: 4000, appliedCents: 1000, destinationSubAccountId: "envelope" },
      { id: "bills", title: "Bills", amountCents: 3000, appliedCents: 0, destinationSubAccountId: "envelope" },
      { id: "rent", title: "Rent", amountCents: 2000, appliedCents: 1000, destinationSubAccountId: "rent-envelope" },
      { id: "paid", title: "Paid", amountCents: 500, appliedCents: 500, destinationSubAccountId: "envelope" },
      { id: "overpaid", title: "Overpaid", amountCents: 500, appliedCents: 700, destinationSubAccountId: "rent-envelope" },
      { id: "cash", title: "Cash", amountCents: 1000, appliedCents: 0, destinationSubAccountId: null },
    ],
  });
  givenClaim(current);
  given("workspaceMember.findMany", [{ userId: "editor" }]);
  given("budgetEnvelope.findMany", [{ id: "envelope", accountId: "bank" }, { id: "rent-envelope", accountId: "rent-bank" }]);
  given("monthlyBudgetPlanItem.update", { id: "food" }, { id: "bills" }, { id: "rent" });
  given("transaction.createMany", { count: 3 });
  given("budgetEnvelope.update", { id: "envelope" }, { id: "rent-envelope" });
  givenFinalPlan(current);
  const result = await confirm();
  assert.equal(result.appliedCents, 7000);
  assert.equal(result.postingGroupId, "posting-group");
  assertPostingBoundary();
  assert.deepEqual(dataCalls("monthlyBudgetPlan.findFirstOrThrow")[0].where, { id: "plan", workspaceId: "home", status: "CONFIRMING" });
  assert.deepEqual(dataCalls("monthlyBudgetPlanItem.update"), [
    { where: { id: "food" }, data: { appliedCents: 4000 } },
    { where: { id: "bills" }, data: { appliedCents: 3000 } },
    { where: { id: "rent" }, data: { appliedCents: 2000 } },
  ]);
  assert.deepEqual(dataCalls("budgetEnvelope.update").map(({ where, data }) => ({ where, data })), [
    { where: { id: "envelope" }, data: { availableCents: { increment: 6000 } } },
    { where: { id: "rent-envelope" }, data: { availableCents: { increment: 1000 } } },
  ]);
  assert.deepEqual(dataCalls("workspaceMember.findMany")[0].where.userId, { in: ["editor"] });
  const rows = dataCalls("transaction.createMany")[0].data;
  assert.deepEqual(rows.map(row => [row.accountId, row.budgetId, row.amountCents, row.externalRef]), [
    ["bank", "envelope", 3000, "monthly-budget-plan:plan:food"],
    ["bank", "envelope", 3000, "monthly-budget-plan:plan:bills"],
    ["rent-bank", "rent-envelope", 1000, "monthly-budget-plan:plan:rent"],
  ]);
  for (const row of rows) {
    assert.equal(row.workspaceId, "home");
    assert.equal(row.kind, "ADJUSTMENT");
    assert.equal(row.direction, "CREDIT");
    assert.equal(row.date.toISOString(), "2026-10-01T12:00:00.000Z");
    assert.equal(row.postingGroupId, "posting-group");
    assert.equal(row.details, "Confirmed budget for 10/2026");
  }
  assert.equal(rows[0].subject, "Monthly budget item: Food");
  assert.deepEqual(calls.slice(-2).map(call => call.name), ["monthlyBudgetPlan.update", "monthlyBudgetPlan.findUniqueOrThrow"]);
});

test("an inconsistent destination lookup fails closed before applying the item's amount", async () => {
  givenClaim();
  given("workspaceMember.findMany", [{ userId: "editor" }]);
  given("budgetEnvelope.findMany", [{ id: "unexpected-envelope", accountId: "bank" }]);
  await assert.rejects(confirm(), error => error.status === 400 && error.message === 'Destination sub-account is missing for "Rent".');
  assertNoFunding();
});

test("a failed ledger write rejects the posting without marking the plan confirmed or changing its balance", async () => {
  givenClaim();
  givenValidReferences();
  given("monthlyBudgetPlanItem.update", { id: "rent" });
  given("transaction.createMany", new Error("Ledger write failed"));
  await assert.rejects(confirm(), /Ledger write failed/);
  assert.deepEqual(dataCalls("monthlyBudgetPlan.update"), []);
  assert.deepEqual(dataCalls("budgetEnvelope.update"), []);
  assertPostingBoundary();
});
