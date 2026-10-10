import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, calls, dataCalls, given, invocations, prisma,
  request, require, state,
} from "./finance-route-harness.mjs";

mock.module("../lib/bank-consistency.ts", { namedExports: {
  async getBankConsistency(...args) {
    calls.push({ name: "consistency", args });
    if (state.consistencyError) throw state.consistencyError;
    return state.consistency;
  },
} });
const { GET, POST } = require("../app/api/accounts/route.ts");
beforeEach(() => { state.consistency = []; state.consistencyError = null; });
async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
const account = { id: "bank", workspaceId: "home", name: "Everyday", startingCents: 2000 };

test("bank lists without a workspace are empty and do not read private account data", async () => {
  assert.deepEqual(await bodyOf(await GET(request("GET"))), []);
  assert.deepEqual(accessChecks, []);
  assert.deepEqual(calls, []);
});

test("bank lists enforce workspace membership before fetching bounded accounts", async () => {
  given("financialAccount.findMany", [account, { ...account, id: "zero", startingCents: 500 }, { ...account, id: "untracked", startingCents: 700 }]);
  state.consistency = [
    { id: "bank", currentBalanceCents: 3000, linkedBudgetTotalCents: 2900, discrepancyCents: 100 },
    { id: "zero", currentBalanceCents: 0, linkedBudgetTotalCents: 0, discrepancyCents: 0 },
  ];
  const body = await bodyOf(await GET(request("GET", undefined, { query: "?workspaceId=home" })));
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
  assert.deepEqual(dataCalls("financialAccount.findMany"), [{ where: { workspaceId: "home", kind: "BANK" }, orderBy: { createdAt: "asc" }, take: 500 }]);
  assert.deepEqual(invocations("consistency")[0].args, [prisma, "home"]);
  assert.deepEqual(body, [
    { ...account, currentBalanceCents: 3000, linkedBudgetTotalCents: 2900, discrepancyCents: 100 },
    { ...account, id: "zero", startingCents: 500, currentBalanceCents: 0, linkedBudgetTotalCents: 0, discrepancyCents: 0 },
    { ...account, id: "untracked", startingCents: 700, currentBalanceCents: 700, linkedBudgetTotalCents: 0, discrepancyCents: 700 },
  ]);
  assertNoWrites();
});

for (const method of ["GET", "POST"]) {
  test(`bank account ${method} returns an authorization rejection without reading or changing accounts`, async () => {
    state.accessError = new ApiAuthError(403, "Forbidden");
    const response = method === "GET"
      ? await GET(request(method, undefined, { query: "?workspaceId=home" }))
      : await POST(request(method, { workspaceId: "home", name: "Everyday" }));
    assert.deepEqual(await bodyOf(response, 403), { error: "Forbidden" });
    assert.equal(invocations("financialAccount.findMany").length, 0);
    assert.equal(invocations("accountType.findFirst").length, 0);
    assertNoWrites();
  });
}

for (const [label, body, expectedName, expectedBank, expectedBalance, expectedDescription] of [
  ["named account", { workspaceId: "home", name: "  Everyday  ", bankName: "DBS", startingCents: 12345, description: "Shared bills" }, "Everyday", "DBS", 12345, "Shared bills"],
  ["bank name fallback", { bankName: "OCBC", name: "  " }, "OCBC Account", "OCBC", 0, undefined],
  ["default account", {}, "Bank Account", undefined, 0, undefined],
]) {
  test(`creating a ${label} reuses its workspace bank type and retains integer cents`, async () => {
    given("accountType.findFirst", { id: "bank-type" });
    given("financialAccount.create", account);
    assert.deepEqual(await bodyOf(await POST(request("POST", body)), 201), { workspaceId: "home", account });
    assert.deepEqual(accessChecks, [{ workspaceId: body.workspaceId, minimumRole: "EDITOR" }]);
    assert.deepEqual(dataCalls("accountType.findFirst"), [{ where: { workspaceId: "home", label: "Bank" } }]);
    assert.equal(invocations("accountType.create").length, 0);
    assert.deepEqual(dataCalls("financialAccount.create"), [{ data: {
      workspaceId: "home", accountTypeId: "bank-type", name: expectedName, bankName: expectedBank,
      kind: "BANK", description: expectedDescription, startingCents: expectedBalance, isActive: true, isSynced: false,
    } }]);
  });
}

test("the first bank account creates the workspace's missing bank type before using it", async () => {
  given("accountType.findFirst", null);
  given("accountType.create", { id: "new-bank-type" });
  given("financialAccount.create", account);
  await bodyOf(await POST(request("POST", { workspaceId: "home" })), 201);
  assert.deepEqual(dataCalls("accountType.create"), [{ data: { workspaceId: "home", label: "Bank", color: "#147349", sortOrder: 1, isActive: true } }]);
  assert.equal(dataCalls("financialAccount.create")[0].data.accountTypeId, "new-bank-type");
  assert.deepEqual(calls.map(({ name }) => name), ["accountType.findFirst", "accountType.create", "financialAccount.create"]);
});

test("invalid bank fields fail before authorization or database access", async () => {
  for (const invalid of [null, { startingCents: -1 }, { startingCents: 1.5 }, { bankName: "" }, { name: "n".repeat(121) }, { description: "d".repeat(501) }]) {
    const body = await bodyOf(await POST(request("POST", invalid)), 400);
    assert.ok(body.error.formErrors.length || Object.keys(body.error.fieldErrors).length);
  }
  assert.deepEqual(accessChecks, []);
  assert.deepEqual(calls, []);
});

test("bank read failures retain the documented error shape for Error and non-Error failures", async () => {
  for (const failure of [new Error("Account storage unavailable"), "Unavailable"]) {
    given("financialAccount.findMany", () => Promise.reject(failure));
    const body = await bodyOf(await GET(request("GET", undefined, { query: "?workspaceId=home" })), 500);
    assert.deepEqual(body, { error: "Failed to fetch bank accounts", message: failure instanceof Error ? failure.message : "Unknown error" });
  }
  assert.equal(invocations("consistency").length, 0);
  assertNoWrites();
});

test("a failed consistency calculation is surfaced instead of returning a misleading balance", async () => {
  given("financialAccount.findMany", [account]);
  state.consistencyError = new Error("Consistency unavailable");
  assert.deepEqual(await bodyOf(await GET(request("GET", undefined, { query: "?workspaceId=home" })), 500), { error: "Failed to fetch bank accounts", message: "Consistency unavailable" });
  assertNoWrites();
});

test("account creation failures stop before dependent writes", async () => {
  given("accountType.findFirst", () => Promise.reject("Type unavailable"));
  assert.deepEqual(await bodyOf(await POST(request("POST", {})), 500), { error: "Failed to create bank account", message: "Unknown error" });
  assertNoWrites();
  given("accountType.findFirst", null);
  given("accountType.create", new Error("Type creation unavailable"));
  assert.deepEqual(await bodyOf(await POST(request("POST", {})), 500), { error: "Failed to create bank account", message: "Type creation unavailable" });
  assert.equal(invocations("financialAccount.create").length, 0);
  given("accountType.findFirst", { id: "bank-type" });
  given("financialAccount.create", new Error("Account creation unavailable"));
  assert.deepEqual(await bodyOf(await POST(request("POST", {})), 500), { error: "Failed to create bank account", message: "Account creation unavailable" });
});
