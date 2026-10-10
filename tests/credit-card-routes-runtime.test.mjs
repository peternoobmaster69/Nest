import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, calls, context, dataCalls, given,
  invocations, request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const collection = require("../app/api/credit-cards/route.ts");
const single = require("../app/api/credit-cards/[id]/route.ts");
const card = { id: "record", cardName: "Everyday", last4Digit: "1234", statementDay: 10, paymentDueDay: 20 };
const createInput = (values = {}) => ({ workspaceId: "home", cardName: "Everyday", last4Digit: "1234", statementDay: 10, paymentDueDay: 20, ...values });
beforeEach((t) => { const logger = mock.method(console, "error", () => {}); t.after(() => logger.mock.restore()); });
async function bodyOf(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test("credit-card lists require workspace membership and select only bounded display metadata", async () => {
  assert.deepEqual(await bodyOf(await collection.GET(request("GET")), 400), { error: "workspaceId is required" });
  assert.deepEqual(accessChecks, []);
  given("creditCardAccount.findMany", [card]);
  const body = await bodyOf(await collection.GET(request("GET", undefined, { query: "?workspaceId=home" })));
  assert.deepEqual(body, [{ ...card, maskedNumber: "•••• •••• •••• 1234" }]);
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
  const [query] = dataCalls("creditCardAccount.findMany");
  assert.deepEqual(query.where, { workspaceId: "home", isActive: true });
  assert.equal(query.take, 500);
  assert.deepEqual(query.orderBy, { updatedAt: "desc" });
  assert.deepEqual(Object.keys(query.select).sort(), ["id", "cardName", "bankName", "themeKey", "last4Digit", "statementDay", "paymentDueDay", "expiryMonth", "expiryYear", "notes", "bonusLimitCents", "bonusStatementCents", "createdAt", "updatedAt"].sort());
  assertNoWrites();
});

test("credit-card list failures preserve authorization and redact internal errors", async () => {
  state.accessError = new ApiAuthError(403, "Forbidden");
  assert.deepEqual(await bodyOf(await collection.GET(request("GET", undefined, { query: "?workspaceId=home" })), 403), { error: "Forbidden" });
  assert.equal(invocations("creditCardAccount.findMany").length, 0);
  state.accessError = null;
  given("creditCardAccount.findMany", new Error("private storage details"));
  assert.deepEqual(await bodyOf(await collection.GET(request("GET", undefined, { query: "?workspaceId=home" })), 500), { error: "Failed to fetch credit cards" });
  assertNoWrites();
});

for (const [label, route, method, payload] of [
  ["creation", collection.POST, "POST", createInput()],
  ["updates", single.PATCH, "PATCH", { cardName: "Updated" }],
]) {
  test(`credit-card ${label} reject foreign origins and unsupported sensitive fields before database access`, async () => {
    await responseBody(await route(request(method, payload, { headers: { origin: "https://untrusted.example" } }), context()), 403);
    for (const forbidden of [{ cardNumber: "4111111111111111" }, { securityCode: "123" }, { workspaceId: "other" }]) {
      if (method === "POST" && "workspaceId" in forbidden) continue;
      await responseBody(await route(request(method, { ...payload, ...forbidden }), context()), 422);
    }
    await responseBody(await route(request(method, payload, { headers: { "content-length": "17000" } }), context()), 413);
    assert.deepEqual(accessChecks, []);
    assert.ok(calls.every(({ name }) => name === "log"));
    assertNoWrites();
  });

  test(`credit-card ${label} enforce EDITOR access before writing`, async () => {
    if (method === "PATCH") given("creditCardAccount.findUnique", { workspaceId: "home" });
    state.accessError = new ApiAuthError(403, "Editor required");
    assert.deepEqual(await responseBody(await route(request(method, payload), context()), 403), { error: "Editor required" });
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
    assertNoWrites();
  });
}

for (const [label, fields, expected] of [
  ["optional defaults", {}, { bankName: null, themeKey: null, notes: null, expiryMonth: null, expiryYear: null }],
  ["trimmed metadata", { cardName: " Everyday ", bankName: " DBS ", themeKey: " green ", notes: " Household ", expiryMonth: 12, expiryYear: 2030 }, { bankName: "DBS", themeKey: "green", notes: "Household", expiryMonth: 12, expiryYear: 2030 }],
  ["blank optional text", { bankName: " ", themeKey: " ", notes: " " }, { bankName: null, themeKey: null, notes: null, expiryMonth: null, expiryYear: null }],
]) {
  test(`card creation persists ${label} and returns the masked number`, async () => {
    given("creditCardAccount.create", card);
    assert.deepEqual(await responseBody(await collection.POST(request("POST", createInput(fields))), 201), { ...card, maskedNumber: "•••• •••• •••• 1234" });
    assert.deepEqual(dataCalls("creditCardAccount.create")[0].data, {
      workspaceId: "home", cardName: "Everyday", last4Digit: "1234", statementDay: 10, paymentDueDay: 20, isActive: true, ...expected,
    });
  });
}

test("card creation storage failures are handled by the secure API wrapper", async () => {
  given("creditCardAccount.create", new Error("private create failure"));
  const body = await responseBody(await collection.POST(request("POST", createInput())), 500);
  assert.equal(body.error, "Failed to create credit card");
  assert.ok(!JSON.stringify(body).includes("private create failure"));
});

test("updates reject missing cards before checking an unrelated workspace", async () => {
  given("creditCardAccount.findUnique", null);
  assert.deepEqual(await responseBody(await single.PATCH(request("PATCH", {}), context()), 404), { error: "Credit card not found" });
  assert.deepEqual(accessChecks, []);
  assertNoWrites();
});

for (const [label, fields, expected] of [
  ["omitted fields", {}, {}],
  ["nullable fields", { bankName: null, themeKey: null, notes: null, expiryMonth: null, expiryYear: null, isActive: false }, { bankName: null, themeKey: null, notes: null, expiryMonth: null, expiryYear: null, isActive: false }],
  ["empty strings", { bankName: "", themeKey: "", notes: "" }, { bankName: null, themeKey: null, notes: null }],
  ["trimmed text and card attributes", { cardName: " Updated ", bankName: " OCBC ", themeKey: " gold ", notes: " Work card ", last4Digit: "9876", statementDay: 12, paymentDueDay: 25, expiryMonth: 6, expiryYear: 2031, isActive: true }, { cardName: "Updated", bankName: "OCBC", themeKey: "gold", notes: "Work card", last4Digit: "9876", statementDay: 12, paymentDueDay: 25, expiryMonth: 6, expiryYear: 2031, isActive: true }],
]) {
  test(`card updates preserve ${label} without changing omitted values`, async () => {
    given("creditCardAccount.findUnique", { workspaceId: "home" });
    given("creditCardAccount.update", { ...card, ...expected });
    const body = await responseBody(await single.PATCH(request("PATCH", fields), context()));
    assert.equal(body.maskedNumber, `•••• •••• •••• ${expected.last4Digit ?? "1234"}`);
    const [query] = dataCalls("creditCardAccount.update");
    assert.deepEqual(query.where, { id: "record" });
    assert.deepEqual(query.data, expected);
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  });
}

test("card update failures never expose private database messages", async () => {
  given("creditCardAccount.findUnique", { workspaceId: "home" });
  given("creditCardAccount.update", new Error("private update details"));
  const body = await responseBody(await single.PATCH(request("PATCH", { notes: "Updated" }), context()), 500);
  assert.equal(body.error, "Failed to update credit card");
  assert.ok(!JSON.stringify(body).includes("private update details"));
});

test("the retired reveal endpoint authenticates first, selects only ownership metadata and stays unavailable", async () => {
  state.sessionError = new ApiAuthError(401, "Sign-in required");
  const denied = await single.GET(request("GET"), context());
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.deepEqual(await bodyOf(denied, 401), { error: "Sign-in required" });
  assert.equal(invocations("creditCardAccount.findUnique").length, 0);
  state.sessionError = null;
  given("creditCardAccount.findUnique", null);
  const missing = await single.GET(request("GET"), context());
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.deepEqual(await bodyOf(missing, 404), { error: "Not found" });
  given("creditCardAccount.findUnique", { id: "record", workspaceId: "home" });
  const unavailable = await single.GET(request("GET"), context());
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.deepEqual(await bodyOf(unavailable, 410), { error: "Card detail reveal is disabled" });
  assert.deepEqual(dataCalls("creditCardAccount.findUnique").at(-1), { where: { id: "record" }, select: { id: true, workspaceId: true } });
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
  assertNoWrites();
});

test("reveal errors keep private details out of responses and remain non-cacheable", async () => {
  given("creditCardAccount.findUnique", new Error("private lookup details"));
  const response = await single.GET(request("GET"), context());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await bodyOf(response, 500), { error: "Failed to reveal credit card" });
});

test("card deletion requires a stored record and EDITOR access before deleting exactly that card", async () => {
  given("creditCardAccount.findUnique", null);
  assert.deepEqual(await bodyOf(await single.DELETE(request("DELETE"), context()), 404), { error: "Credit card not found" });
  given("creditCardAccount.findUnique", { workspaceId: "home" });
  state.accessError = new ApiAuthError(403, "Forbidden");
  assert.deepEqual(await bodyOf(await single.DELETE(request("DELETE"), context()), 403), { error: "Forbidden" });
  assertNoWrites();
  state.accessError = null;
  given("creditCardAccount.findUnique", { workspaceId: "home" });
  given("creditCardAccount.delete", card);
  assert.deepEqual(await bodyOf(await single.DELETE(request("DELETE"), context())), { ok: true });
  assert.deepEqual(dataCalls("creditCardAccount.delete"), [{ where: { id: "record" } }]);
  assert.ok(accessChecks.every(({ workspaceId, minimumRole }) => workspaceId === "home" && minimumRole === "EDITOR"));
});

test("card deletion failures return a safe error", async () => {
  given("creditCardAccount.findUnique", { workspaceId: "home" });
  given("creditCardAccount.delete", new Error("private delete details"));
  assert.deepEqual(await bodyOf(await single.DELETE(request("DELETE"), context()), 500), { error: "Failed to delete credit card" });
});
