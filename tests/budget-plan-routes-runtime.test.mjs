import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, calls, dataCalls, given,
  PostingConflictError, request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const { Prisma } = require("@prisma/client");
const { rateLimitResponse } = require("../lib/security-rate-limit.ts");
mock.module("../lib/security-rate-limit.ts", { namedExports: {
  rateLimitResponse,
  async enforceDistributedRateLimit(_request, options) {
    calls.push({ name: "rate", args: [options] });
    if (state.rateError) throw state.rateError;
  },
} });
const route = require("../app/api/budgets/plan/route.ts");
beforeEach(t => {
  state.rateError = null;
  t.mock.method(console, "error", () => {});
});
const itemInput = (values = {}) => ({ action: "createTemplateItem", workspaceId: "home", title: "Groceries", amountCents: 12000, ...values });

test("a cross-origin budget request cannot create a template or reach authorization", async () => {
  given("budgetItem.create", { id: "must-not-create" });
  const response = await route.POST(request("POST", itemInput(), { headers: { origin: "https://untrusted.example" } }));
  assert.equal(response.status, 403);
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

test("malformed JSON receives a client error without writing budget records", async () => {
  const response = await route.POST(request("POST", undefined, { rawBody: "{" }));
  assert.equal(response.status, 400);
  assertNoWrites();
});

const get = (query = "") => route.GET(request("GET", undefined, { query: `?workspaceId=home${query}` }));
const post = (input, options) => route.POST(request("POST", input, options));
const patch = (input, options) => route.PATCH(request("PATCH", input, options));
const remove = (type, options = {}) => route.DELETE(request("DELETE", undefined, { query: `?workspaceId=home&type=${type}&id=record`, ...options }));
const monthlyInput = (action, values = {}) => ({ ...itemInput(), action, planId: "plan", ...values });
const sourceInput = (action, values = {}) => ({ ...itemInput(), action, ownerId: "editor", ...values });
const draft = (values = {}) => ({ id: "plan", status: "DRAFT", year: 2026, month: 10, items: [], sources: [], ...values });
function givenRead({ items = [], sources = [], members = [], subAccounts = [], plan = null } = {}) {
  given("budgetItem.findMany", items);
  given("budgetSource.findMany", sources);
  given("workspaceMember.findMany", members);
  given("budgetEnvelope.findMany", subAccounts);
  given("monthlyBudgetPlan.findFirst", plan);
}
function assertSerializable() {
  assert.deepEqual(dataCalls("$transaction"), [{ isolationLevel: "Serializable" }]);
  assert.ok(calls.filter(call => /\.(?:create|update|delete|aggregate|find)/.test(call.name)).every(call => call.inTransaction));
}
function assertEditor() { assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]); }

for (const withPeriod of [false, true]) {
  test(`budget reads return only the authorized workspace's setup${withPeriod ? " and requested month" : " without a monthly lookup"}`, async () => {
    const data = { items: [{ id: "item" }], sources: [{ id: "source" }], members: [{ userId: "editor" }], subAccounts: [{ id: "envelope" }], plan: withPeriod ? draft() : null };
    givenRead(data);
    assert.deepEqual(await responseBody(await get(withPeriod ? "&year=2026&month=10" : "")), { setup: { items: data.items, sources: data.sources }, members: data.members, subAccounts: data.subAccounts, monthlyPlan: data.plan });
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
    for (const model of ["budgetItem", "budgetSource", "workspaceMember", "budgetEnvelope"]) {
      assert.equal(dataCalls(`${model}.findMany`)[0].where.workspaceId, "home");
    }
    const plans = dataCalls("monthlyBudgetPlan.findFirst");
    assert.equal(plans.length, Number(withPeriod));
    if (withPeriod) assert.deepEqual(plans[0].where, { workspaceId: "home", year: 2026, month: 10 });
    assertNoWrites();
  });
}

for (const [query, status] of [["&year=2026", 400], ["&month=10", 400], ["&year=abc&month=10", 422], ["&year=2026&month=13", 422]]) {
  test(`incomplete or invalid budget periods are client errors (${query})`, async () => {
    const body = await responseBody(await get(query), status);
    assert.match(body.error, /Both year and month|Invalid budget plan request/);
    assertNoWrites();
  });
}

for (const method of ["POST", "PATCH", "DELETE"]) {
  test(`${method} rejects cross-site requests even when no Origin is provided`, async () => {
    const headers = { "sec-fetch-site": "cross-site" };
    const req = request(method, method === "DELETE" ? undefined : {}, { headers });
    req.headers.delete("origin");
    await responseBody(await route[method](req), 403);
    assert.deepEqual(accessChecks, []);
    assert.deepEqual(dataCalls("rate"), []);
    assertNoWrites();
  });
  test(`${method} keeps the distributed mutation limit and Retry-After response`, async () => {
    state.rateError = Object.assign(new Error("Too many requests"), { retryAfter: 17 });
    const response = await route[method](request(method, method === "DELETE" ? undefined : {}));
    assert.equal(response.headers.get("retry-after"), "17");
    assert.equal((await responseBody(response, 429)).code, "RATE_LIMITED");
    assert.deepEqual(dataCalls("rate"), [{ scope: `budget-plan-${method.toLowerCase()}`, limit: 30, windowMs: 600000, blockMs: 600000 }]);
    assert.deepEqual(accessChecks, []);
    assertNoWrites();
  });
}

for (const [options, status] of [
  [{ headers: { "content-type": "text/plain" } }, 415],
  [{ headers: { "content-length": "65537" } }, 413],
  [{ rawBody: JSON.stringify({ action: "createTemplateItem", padding: "x".repeat(65537) }) }, 413],
]) {
  test(`budget mutations reject unsupported or oversized bodies (${status}, ${Boolean(options.rawBody)})`, async () => {
    await responseBody(await post(itemInput(), options), status);
    assert.deepEqual(accessChecks, []);
    assertNoWrites();
  });
}

for (const method of ["POST", "PATCH"]) {
  for (const input of [null, {}, { action: 7 }, { action: "constructor" }, { action: "unknown" }]) {
    test(`${method} rejects unknown actions before authentication (${JSON.stringify(input)})`, async () => {
      const body = await responseBody(await route[method](request(method, input)), 400);
      assert.equal(body.error, "Invalid action");
      assert.deepEqual(accessChecks, []);
      assertNoWrites();
    });
  }
}

for (const [method, action] of [
  ...["createTemplateItem", "createTemplateSource", "startBlank", "startFromSetup", "createMonthlyItem", "createMonthlySource", "discardMonthlyDraft", "confirmMonthly"].map(action => ["POST", action]),
  ...["updateTemplateItem", "updateTemplateSource", "updateMonthlyItem", "updateMonthlySource"].map(action => ["PATCH", action]),
]) {
  test(`${action} validates its own required fields before workspace access`, async () => {
    const body = await responseBody(await route[method](request(method, { action })), 422);
    assert.equal(body.code, "UNPROCESSABLE_ENTITY");
    assert.ok(body.details.fieldErrors.workspaceId);
    assert.deepEqual(accessChecks, []);
    assertNoWrites();
  });
}

test("budget deletion rejects an unsupported record type without any lookup", async () => {
  await responseBody(await remove("__proto__"), 422);
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

for (const [name, send] of [["GET", () => get()], ["POST", () => post(itemInput())], ["PATCH", () => patch(itemInput({ action: "updateTemplateItem", id: "record" }))], ["DELETE", () => remove("templateItem")]]) {
  test(`${name} preserves authentication errors without accessing the ledger`, async () => {
    state.accessError = new ApiAuthError(403, "Workspace access denied");
    const body = await responseBody(await send(), 403);
    assert.equal(body.error, "Workspace access denied");
    assertNoWrites();
  });
}

for (const [code, status, message] of [["P2002", 409, "A budget plan already exists for this period."], ["P2025", 404, "Budget plan record not found."], ["P2010", 500, "Failed to load budget plan"]]) {
  test(`budget storage error ${code} keeps the public error contract`, async () => {
    givenRead();
    given("budgetItem.findMany", new Prisma.PrismaClientKnownRequestError("private storage diagnostic", { code, clientVersion: "test" }));
    const body = await responseBody(await get(), status);
    assert.equal(body.error, message);
    assert.doesNotMatch(JSON.stringify(body), /private storage diagnostic/);
  });
}

test("unknown provider failures are safe and posting conflicts remain retryable client conflicts", async () => {
  state.rateError = new Error("private rate storage detail");
  assert.equal((await responseBody(await post(itemInput()), 500)).error, "Failed to process budget plan request");
  state.rateError = null;
  state.postingError = new PostingConflictError("This confirmation key was already used");
  const body = await responseBody(await post(monthlyInput("confirmMonthly")), 409);
  assert.equal(body.code, "CONFLICT");
  assert.equal(body.error, "This confirmation key was already used");
});

for (const key of ["operation-once", ""]) {
  test(`confirmation passes authenticated ownership and ${key ? "the request" : "the stable monthly"} idempotency key to the ledger`, async () => {
    state.replayedPosting = { result: { monthlyPlan: { id: "plan", status: "CONFIRMED" }, appliedCents: 12000, appliedToSubAccounts: true }, postingGroupId: "original-posting", replayed: true };
    const body = await responseBody(await post(monthlyInput("confirmMonthly"), { headers: { "idempotency-key": key } }));
    assert.equal(body.replayed, true);
    assert.equal(body.postingGroupId, "original-posting");
    assert.equal(body.appliedCents, 12000);
    const [operation] = dataCalls("posting");
    assert.equal(operation.workspaceId, "home");
    assert.equal(operation.actorUserId, "editor");
    assert.equal(operation.idempotencyKey, key || "monthly-budget-confirm:plan");
    assert.equal(operation.request.applyToSubAccounts, false);
    assert.deepEqual(dataCalls("monthlyBudgetPlan.updateMany"), []);
    assertEditor();
  });
}

for (const destination of [undefined, "envelope"]) {
  test(`template items preserve ${destination ? "a verified destination and non-monthly flag" : "monthly defaults without a destination"}`, async () => {
    if (destination) given("budgetEnvelope.findFirst", { id: destination, accountId: "bank" });
    given("budgetItem.create", { id: "new-item" });
    const input = itemInput({ title: "  Groceries  ", destinationSubAccountId: destination, ...(destination ? { isMonthly: false } : {}) });
    assert.deepEqual(await responseBody(await post(input), 201), { id: "new-item" });
    assertEditor();
    assert.deepEqual(dataCalls("budgetItem.create")[0].data, { workspaceId: "home", title: "Groceries", amountCents: 12000, isMonthly: !destination, destinationSubAccountId: destination ?? null });
    if (destination) assert.deepEqual(dataCalls("budgetEnvelope.findFirst")[0].where, { id: destination, workspaceId: "home" });
  });
}

test("template sources verify membership before saving an owner", async () => {
  given("workspaceMember.findUnique", { userId: "editor" });
  given("budgetSource.create", { id: "new-source" });
  assert.deepEqual(await responseBody(await post(sourceInput("createTemplateSource")), 201), { id: "new-source" });
  assert.deepEqual(dataCalls("workspaceMember.findUnique")[0].where, { workspaceId_userId: { workspaceId: "home", userId: "editor" } });
  assert.deepEqual(dataCalls("budgetSource.create")[0].data, { workspaceId: "home", title: "Groceries", amountCents: 12000, ownerId: "editor" });
  assertEditor();
});

for (const isSource of [false, true]) {
  test(`template ${isSource ? "source" : "item"} creation rejects a reference outside the workspace`, async () => {
    given(isSource ? "workspaceMember.findUnique" : "budgetEnvelope.findFirst", null);
    const body = await responseBody(await post(isSource ? sourceInput("createTemplateSource") : itemInput({ destinationSubAccountId: "foreign" })), 400);
    assert.match(body.error, /not a member|not in this workspace/);
    assertNoWrites();
  });
}

for (const kind of ["Item", "Source"]) {
  const model = `budget${kind}`;
  const input = kind === "Item" ? itemInput({ action: "updateTemplateItem", id: "record" }) : sourceInput("updateTemplateSource", { id: "record" });
  for (const exists of [false, true]) {
    test(`updating a template ${kind.toLowerCase()} ${exists ? "keeps its verified references" : "cannot reach another workspace's record"}`, async () => {
      given(`${model}.findFirst`, exists ? { id: "record" } : null);
      if (exists) {
        if (kind === "Source") given("workspaceMember.findUnique", { userId: "editor" });
        given(`${model}.update`, { id: "record", title: "Groceries" });
      }
      const body = await responseBody(await patch(input), exists ? 200 : 404);
      assert.deepEqual(dataCalls(`${model}.findFirst`)[0].where, { id: "record", workspaceId: "home", isActive: true });
      assertEditor();
      if (exists) {
        assert.equal(body.title, "Groceries");
        assert.deepEqual(dataCalls(`${model}.update`)[0].data, kind === "Item"
          ? { title: "Groceries", amountCents: 12000, isMonthly: true, destinationSubAccountId: null }
          : { title: "Groceries", amountCents: 12000, ownerId: "editor" });
      } else assertNoWrites();
    });
  }
  for (const exists of [false, true]) {
    test(`archiving a template ${kind.toLowerCase()} ${exists ? "retains history" : "fails for missing or foreign records"}`, async () => {
      given(`${model}.findFirst`, exists ? { id: "record" } : null);
      if (exists) given(`${model}.update`, { id: "record" });
      await responseBody(await remove(`template${kind}`), exists ? 200 : 404);
      assert.deepEqual(dataCalls(`${model}.findFirst`)[0].where, { id: "record", workspaceId: "home", isActive: true });
      if (exists) assert.deepEqual(dataCalls(`${model}.update`), [{ where: { id: "record" }, data: { isActive: false } }]);
      else assertNoWrites();
    });
  }
}

test("updating a template item stores its new workspace-scoped destination", async () => {
  given("budgetItem.findFirst", { id: "record" });
  given("budgetEnvelope.findFirst", { id: "envelope", accountId: "bank" });
  given("budgetItem.update", { id: "record" });
  await responseBody(await patch(itemInput({ action: "updateTemplateItem", id: "record", destinationSubAccountId: "envelope" })));
  assert.equal(dataCalls("budgetItem.update")[0].data.destinationSubAccountId, "envelope");
});

for (const existing of [null, draft(), draft({ status: "CONFIRMED" })]) {
  test(`starting a blank month ${existing ? `preserves an existing ${existing.status} plan` : "creates one serializable draft"}`, async () => {
    given("monthlyBudgetPlan.findFirst", existing);
    if (!existing) given("monthlyBudgetPlan.create", draft());
    const body = await responseBody(await post({ action: "startBlank", workspaceId: "home", year: 2026, month: 10 }), existing?.status === "CONFIRMED" ? 409 : 201);
    assertSerializable();
    assert.deepEqual(dataCalls("monthlyBudgetPlan.findFirst")[0].where, { workspaceId: "home", year: 2026, month: 10 });
    if (existing) assertNoWrites();
    else {
      assert.equal(body.status, "DRAFT");
      assert.deepEqual(dataCalls("monthlyBudgetPlan.create")[0].data, { workspaceId: "home", year: 2026, month: 10 });
    }
  });
}

for (const existing of [draft({ status: "REVIEW" }), draft({ items: [{ id: "existing" }] }), draft({ sources: [{ id: "existing" }] })]) {
  test(`applying setup never overwrites a read-only or nonempty draft (${JSON.stringify(existing)})`, async () => {
    given("monthlyBudgetPlan.findFirst", existing);
    await responseBody(await post({ action: "startFromSetup", workspaceId: "home", year: 2026, month: 10 }), 409);
    assertNoWrites();
    assertSerializable();
  });
}

for (const existing of [null, draft()]) {
  test(`budget setup copies immutable source and item snapshots into ${existing ? "an empty" : "a new"} draft`, async () => {
    given("monthlyBudgetPlan.findFirst", existing);
    given("budgetItem.findMany", [{ id: "template-item", title: "Rent", amountCents: 90000, destinationSubAccountId: "envelope" }, { id: "template-no-destination", title: "Cash", amountCents: 10000, destinationSubAccountId: null }]);
    given("budgetSource.findMany", [{ id: "template-source", title: "Salary", amountCents: 100000, ownerId: "editor" }]);
    given("workspaceMember.findMany", [{ userId: "editor" }]);
    given("budgetEnvelope.findMany", [{ id: "envelope" }]);
    if (!existing) given("monthlyBudgetPlan.create", draft());
    given("monthlyBudgetPlanItem.createMany", { count: 2 });
    given("monthlyBudgetPlanSource.createMany", { count: 1 });
    given("monthlyBudgetPlan.findUniqueOrThrow", draft({ items: [{ title: "Rent" }] }));
    const body = await responseBody(await post({ action: "startFromSetup", workspaceId: "home", year: 2026, month: 10 }), 201);
    assert.equal(body.items[0].title, "Rent");
    assertSerializable();
    assert.deepEqual(dataCalls("budgetItem.findMany")[0].where, { workspaceId: "home", isActive: true, isMonthly: true });
    assert.deepEqual(dataCalls("monthlyBudgetPlanSource.createMany")[0].data, [{ planId: "plan", templateSourceId: "template-source", title: "Salary", ownerId: "editor", amountCents: 100000, sortOrder: 0 }]);
    assert.deepEqual(dataCalls("monthlyBudgetPlanItem.createMany")[0].data, [
      { planId: "plan", templateItemId: "template-item", title: "Rent", amountCents: 90000, destinationSubAccountId: "envelope", sortOrder: 0 },
      { planId: "plan", templateItemId: "template-no-destination", title: "Cash", amountCents: 10000, destinationSubAccountId: null, sortOrder: 1 },
    ]);
  });
}

test("empty setup still returns a draft without writing empty child batches", async () => {
  givenRead();
  given("monthlyBudgetPlan.create", draft());
  given("monthlyBudgetPlan.findUniqueOrThrow", draft());
  await responseBody(await post({ action: "startFromSetup", workspaceId: "home", year: 2026, month: 10 }), 201);
  assert.deepEqual(dataCalls("budgetEnvelope.findMany"), []);
  assert.deepEqual(dataCalls("monthlyBudgetPlanItem.createMany"), []);
  assert.deepEqual(dataCalls("monthlyBudgetPlanSource.createMany"), []);
});

test("setup can copy only budget items into an existing empty draft while leaving income for later", async () => {
  const item = { id: "template-item", title: "Rent", amountCents: 10000, destinationSubAccountId: null };
  givenRead({ items: [item], plan: draft() });
  given("monthlyBudgetPlanItem.createMany", { count: 1 });
  given("monthlyBudgetPlan.findUniqueOrThrow", draft({ items: [item] }));
  const body = await responseBody(await post({ action: "startFromSetup", workspaceId: "home", year: 2026, month: 10 }), 201);
  assert.equal(body.items.length, 1);
  assert.deepEqual(body.sources, []);
  assert.deepEqual(dataCalls("monthlyBudgetPlan.create"), []);
  assert.deepEqual(dataCalls("monthlyBudgetPlanSource.createMany"), []);
  assertSerializable();
});

for (const invalidReference of ["owner", "destination"]) {
  test(`budget setup rejects an invalid ${invalidReference} before creating the draft`, async () => {
    givenRead({ items: [{ id: "item", destinationSubAccountId: "foreign" }], sources: [{ id: "source", title: "Salary", ownerId: "editor" }], members: invalidReference === "owner" ? [] : [{ userId: "editor" }] });
    const body = await responseBody(await post({ action: "startFromSetup", workspaceId: "home", year: 2026, month: 10 }), 400);
    assert.match(body.error, /outside this workspace/);
    assertNoWrites();
  });
}

for (const kind of ["Item", "Source"]) {
  const model = `monthlyBudgetPlan${kind}`;
  for (const sortOrder of [null, 4]) {
    test(`new monthly ${kind.toLowerCase()} rows append after ${sortOrder ?? "an empty plan"} within a serializable draft`, async () => {
      given("monthlyBudgetPlan.findFirst", draft());
      if (kind === "Source") given("workspaceMember.findUnique", { userId: "editor" });
      else if (sortOrder !== null) given("budgetEnvelope.findFirst", { id: "envelope" });
      given(`${model}.aggregate`, { _max: { sortOrder } });
      given(`${model}.create`, { id: "created-row" });
      const input = kind === "Item" ? monthlyInput("createMonthlyItem", { destinationSubAccountId: sortOrder === null ? null : "envelope" }) : sourceInput("createMonthlySource", { planId: "plan" });
      await responseBody(await post(input), 201);
      assertSerializable();
      assertEditor();
      const { data } = dataCalls(`${model}.create`)[0];
      assert.equal(data.planId, "plan");
      assert.equal(data.sortOrder, sortOrder === null ? 0 : 5);
      assert.equal(data.amountCents, 12000);
      assert.equal(kind === "Item" ? data.destinationSubAccountId : data.ownerId, kind === "Source" ? "editor" : input.destinationSubAccountId);
    });
  }
  for (const exists of [false, true]) {
    test(`monthly ${kind.toLowerCase()} edits ${exists ? "preserve the plan boundary" : "reject a record in another plan"}`, async () => {
      given("monthlyBudgetPlan.findFirst", draft());
      if (kind === "Source") given("workspaceMember.findUnique", { userId: "editor" });
      given(`${model}.findFirst`, exists ? { id: "record" } : null);
      if (exists) given(`${model}.update`, { id: "record" });
      const input = kind === "Item" ? monthlyInput("updateMonthlyItem", { id: "record" }) : sourceInput("updateMonthlySource", { planId: "plan", id: "record" });
      await responseBody(await patch(input), exists ? 200 : 404);
      assert.deepEqual(dataCalls(`${model}.findFirst`)[0].where, { id: "record", planId: "plan" });
      assertSerializable();
      if (!exists) assertNoWrites();
      else assert.deepEqual(dataCalls(`${model}.update`)[0].data, kind === "Item"
        ? { title: "Groceries", amountCents: 12000, destinationSubAccountId: null }
        : { title: "Groceries", amountCents: 12000, ownerId: "editor" });
    });
  }
  for (const exists of [false, true]) {
    test(`deleting a monthly ${kind.toLowerCase()} ${exists ? "requires an editable plan" : "cannot reach a foreign row"}`, async () => {
      given(`${model}.findFirst`, exists ? { id: "record", planId: "plan" } : null);
      if (exists) {
        given("monthlyBudgetPlan.findFirst", draft());
        given(`${model}.delete`, { id: "record" });
      }
      await responseBody(await remove(`monthly${kind}`), exists ? 200 : 404);
      assert.deepEqual(dataCalls(`${model}.findFirst`)[0].where, { id: "record", plan: { workspaceId: "home" } });
      assertSerializable();
      if (exists) assert.deepEqual(dataCalls(`${model}.delete`), [{ where: { id: "record" } }]);
      else assertNoWrites();
    });
  }
}

test("monthly item edits verify a newly selected destination", async () => {
  given("monthlyBudgetPlan.findFirst", draft());
  given("budgetEnvelope.findFirst", { id: "envelope" });
  given("monthlyBudgetPlanItem.findFirst", { id: "record" });
  given("monthlyBudgetPlanItem.update", { id: "record" });
  await responseBody(await patch(monthlyInput("updateMonthlyItem", { id: "record", destinationSubAccountId: "envelope" })));
  assert.equal(dataCalls("monthlyBudgetPlanItem.update")[0].data.destinationSubAccountId, "envelope");
});

for (const plan of [null, draft({ status: "CONFIRMED" }), draft()]) {
  test(`discarding ${plan ? `a ${plan.status} draft` : "a missing plan"} never deletes confirmed history`, async () => {
    given("monthlyBudgetPlan.findFirst", plan);
    const editable = plan?.status === "DRAFT";
    if (editable) {
      given("monthlyBudgetPlanItem.deleteMany", { count: 2 });
      given("monthlyBudgetPlanSource.deleteMany", { count: 1 });
      given("monthlyBudgetPlan.delete", { id: "plan" });
    }
    const body = await responseBody(await post(monthlyInput("discardMonthlyDraft")), !plan ? 404 : (editable ? 200 : 409));
    assertSerializable();
    assert.deepEqual(dataCalls("monthlyBudgetPlan.findFirst")[0].where, { id: "plan", workspaceId: "home" });
    if (editable) {
      assert.deepEqual(body, { success: true });
      assert.deepEqual(calls.filter(call => /\.delete/.test(call.name)).map(call => call.name), ["monthlyBudgetPlanItem.deleteMany", "monthlyBudgetPlanSource.deleteMany", "monthlyBudgetPlan.delete"]);
    } else assertNoWrites();
  });
}
