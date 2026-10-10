import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiAuthError, accessChecks, assertNoWrites, context, dataCalls, given,
  request, require, responseBody, state,
} from "./finance-route-harness.mjs";

const collection = require("../app/api/investments/route.ts");
const accountRoute = require("../app/api/investments/[id]/route.ts");
const entries = require("../app/api/investments/[id]/entries/route.ts");
const entryRoute = require("../app/api/investments/entries/[entryId]/route.ts");
const inceptionDate = "2026-01-01T00:00:00.000Z";
const accountInput = { workspaceId: "home", institutionName: " Brokerage ", productName: " Index fund ", inceptionDate };
const entryInput = { date: inceptionDate, investedCents: 1234, currentValueCents: 1500 };
const entryContext = () => ({ params: Promise.resolve({ entryId: "entry" }) });
const read = (query = "workspaceId=home") => collection.GET(request("GET", undefined, { query: `?${query}` }));
const addAccount = (body = {}, options = {}) => collection.POST(request("POST", { ...accountInput, ...body }, options));
const editAccount = (body = {}, options = {}) => accountRoute.PATCH(request("PATCH", body, options), context());
const removeAccount = (_body, options = {}) => accountRoute.DELETE(request("DELETE", undefined, options), context());
const addEntry = (body = {}, options = {}) => entries.POST(request("POST", { ...entryInput, ...body }, options), context());
const editEntry = (body = {}, options = {}) => entryRoute.PATCH(request("PATCH", body, options), entryContext());
const removeEntry = (_body, options = {}) => entryRoute.DELETE(request("DELETE", undefined, options), entryContext());
const account = { workspaceId: "home" };
const entry = { account: { workspaceId: "home" } };
const existingAccount = () => given("investmentAccount.findUnique", account);
const existingEntry = () => given("investmentEntry.findUnique", entry);

const mutations = [
  { label: "account creation", execute: addAccount, lookup: "investmentAccount.create", error: "Failed to create investment account", body: true },
  { label: "account edit", execute: editAccount, lookup: "investmentAccount.findUnique", existing: existingAccount, error: "Failed to update investment account", body: true },
  { label: "account deletion", execute: removeAccount, lookup: "investmentAccount.findUnique", existing: existingAccount, error: "Failed to delete investment account" },
  { label: "entry creation", execute: addEntry, lookup: "investmentAccount.findUnique", existing: existingAccount, error: "Failed to create investment entry", body: true },
  { label: "entry edit", execute: editEntry, lookup: "investmentEntry.findUnique", existing: existingEntry, error: "Failed to update investment entry", body: true },
  { label: "entry deletion", execute: removeEntry, lookup: "investmentEntry.findUnique", existing: existingEntry, error: "Failed to delete investment entry" },
];

for (const { label, execute, lookup, existing, error, body } of mutations) {
  test(`investment ${label} rejects cross-origin requests before accessing finance data`, async () => {
    await responseBody(await execute({}, { headers: { origin: "https://untrusted.example" } }), 403);
    assert.deepEqual(accessChecks, []);
    assert.deepEqual(dataCalls(lookup), []);
    assertNoWrites();
  });

  test(`investment ${label} requires EDITOR access to the record workspace`, async () => {
    existing?.();
    state.accessError = new ApiAuthError(403, "Editor access required");
    assert.equal((await responseBody(await execute(), 403)).error, "Editor access required");
    assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
    assertNoWrites();
  });

  test(`investment ${label} failures do not disclose database errors`, async () => {
    given(lookup, new Error("private financial database diagnostic"));
    const result = await responseBody(await execute(), 500);
    assert.equal(result.error, error);
    assert.equal(result.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(result), /private financial|diagnostic/);
  });

  if (existing) {
    test(`investment ${label} stops when its source record is missing`, async () => {
      given(lookup, null);
      const result = await responseBody(await execute(), 404);
      assert.match(result.error, /Investment (account|entry) not found/);
      assert.deepEqual(accessChecks, []);
      assertNoWrites();
    });
  }

  if (body) {
    for (const [label, options, status] of [
      ["malformed JSON", { rawBody: "{" }, 400],
      ["a non-JSON body", { headers: { "content-type": "text/plain" } }, 415],
      ["an oversized body", { headers: { "content-length": "65537" } }, 413],
      ["an invalid payload", { rawBody: "null" }, 400],
    ]) {
      test(`${execute.name} rejects ${label} before authorization or storage access`, async () => {
        await responseBody(await execute({}, options), status);
        assert.deepEqual(accessChecks, []);
        assert.deepEqual(dataCalls(lookup), []);
        assertNoWrites();
      });
    }
  }
}

test("investment lists require a workspace and membership before listing accounts", async () => {
  assert.deepEqual(await responseBody(await read(""), 400), { error: "workspaceId is required" });
  assert.deepEqual(accessChecks, []);
  state.accessError = new ApiAuthError(401, "Sign-in required");
  assert.equal((await responseBody(await read(), 401)).error, "Sign-in required");
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: undefined }]);
  assert.deepEqual(dataCalls("investmentAccount.findMany"), []);
});

test("investment lists select bounded recent entries and present them in chronological order", async () => {
  const newest = { id: "latest", currentValueCents: 2000 };
  const oldest = { id: "earliest", currentValueCents: 1500 };
  const rows = [{ id: "investment", entries: [newest, oldest] }, { id: "empty", entries: [] }];
  given("investmentAccount.findMany", rows);
  assert.deepEqual(await responseBody(await read()), [{ id: "investment", entries: [oldest, newest] }, { id: "empty", entries: [] }]);
  assert.deepEqual(rows[0].entries, [newest, oldest], "presentation must not mutate the fetched entries");
  assert.deepEqual(dataCalls("investmentAccount.findMany"), [{
    where: { workspaceId: "home" }, take: 500,
    include: { entries: { orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 5000 } },
    orderBy: [{ inceptionDate: "asc" }, { createdAt: "asc" }],
  }]);
  assertNoWrites();
});

test("investment list failures return a safe response with private cache headers", async () => {
  given("investmentAccount.findMany", new Error("private portfolio details"));
  const result = await responseBody(await read(), 500);
  assert.equal(result.error, "Failed to fetch investments");
  assert.doesNotMatch(JSON.stringify(result), /private portfolio/);
});

for (const [label, input, expected] of [
  ["omitted optional fields", {}, { displayName: null, divestedDate: null, isLiquid: false }],
  ["blank display name and explicit false", { displayName: "  ", isLiquid: false, divestedDate: null }, { displayName: null, divestedDate: null, isLiquid: false }],
  ["custom label, liquidation and divestment", { displayName: "  Retirement  ", isLiquid: true, divestedDate: "2026-09-10T00:00:00.000Z" }, { displayName: "Retirement", isLiquid: true, divestedDate: new Date("2026-09-10T00:00:00.000Z") }],
]) {
  test(`investment creation preserves ${label}`, async () => {
    given("investmentAccount.create", { id: "new-account" });
    assert.deepEqual(await responseBody(await addAccount(input), 201), { id: "new-account" });
    assert.deepEqual(dataCalls("investmentAccount.create"), [{ data: {
      workspaceId: "home", institutionName: "Brokerage", productName: "Index fund", inceptionDate: new Date(inceptionDate), ...expected,
    } }]);
  });
}

test("investment edits preserve omitted fields while discarding unrecognized ownership changes", async () => {
  existingAccount();
  given("investmentAccount.update", { id: "record" });
  await responseBody(await editAccount({ workspaceId: "private" }));
  assert.deepEqual(dataCalls("investmentAccount.update"), [{ where: { id: "record" }, data: {
    displayName: undefined, institutionName: undefined, productName: undefined, inceptionDate: undefined, divestedDate: undefined, isLiquid: undefined,
  } }]);
});

test("investment edits trim labels, convert dates and retain explicit false", async () => {
  existingAccount();
  given("investmentAccount.update", { id: "record", displayName: "Portfolio" });
  const divestedDate = "2026-10-01T00:00:00.000Z";
  assert.deepEqual(await responseBody(await editAccount({ displayName: " Portfolio ", institutionName: " Broker ", productName: " Fund ", inceptionDate, divestedDate, isLiquid: false })), { id: "record", displayName: "Portfolio" });
  assert.deepEqual(dataCalls("investmentAccount.update"), [{ where: { id: "record" }, data: {
    displayName: "Portfolio", institutionName: "Broker", productName: "Fund", inceptionDate: new Date(inceptionDate), divestedDate: new Date(divestedDate), isLiquid: false,
  } }]);
});

test("investment edits can clear a display name and divestment date", async () => {
  existingAccount();
  given("investmentAccount.update", { id: "record" });
  await responseBody(await editAccount({ displayName: " ", divestedDate: null, isLiquid: true }));
  const [query] = dataCalls("investmentAccount.update");
  assert.equal(query.data.displayName, null);
  assert.equal(query.data.divestedDate, null);
  assert.equal(query.data.isLiquid, true);
  assert.equal(query.data.inceptionDate, undefined);
});

test("investment account deletion checks ownership before deleting the requested account", async () => {
  existingAccount();
  given("investmentAccount.delete", { id: "record" });
  assert.deepEqual(await responseBody(await removeAccount()), { ok: true });
  assert.deepEqual(dataCalls("investmentAccount.findUnique"), [{ where: { id: "record" }, select: { workspaceId: true } }]);
  assert.deepEqual(dataCalls("investmentAccount.delete"), [{ where: { id: "record" } }]);
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
});

test("investment entries bind to the authorized account and retain signed integer amounts", async () => {
  existingAccount();
  given("investmentEntry.create", { id: "new-entry" });
  assert.deepEqual(await responseBody(await addEntry({ investedCents: -500, currentValueCents: 0, accountId: "injected" }), 201), { id: "new-entry" });
  assert.deepEqual(dataCalls("investmentEntry.create"), [{ data: { accountId: "record", date: new Date(inceptionDate), investedCents: -500, currentValueCents: 0 } }]);
});

test("investment entry edits preserve omitted fields and prevent reassignment to another account", async () => {
  existingEntry();
  given("investmentEntry.update", { id: "entry" });
  await responseBody(await editEntry({ accountId: "private" }));
  assert.deepEqual(dataCalls("investmentEntry.findUnique"), [{ where: { id: "entry" }, select: { account: { select: { workspaceId: true } } } }]);
  assert.deepEqual(dataCalls("investmentEntry.update"), [{ where: { id: "entry" }, data: { date: undefined, investedCents: undefined, currentValueCents: undefined } }]);
});

test("investment entry edits convert dates while preserving zero and negative values", async () => {
  existingEntry();
  given("investmentEntry.update", { id: "entry" });
  assert.deepEqual(await responseBody(await editEntry({ date: inceptionDate, investedCents: 0, currentValueCents: -25 })), { id: "entry" });
  assert.deepEqual(dataCalls("investmentEntry.update"), [{ where: { id: "entry" }, data: { date: new Date(inceptionDate), investedCents: 0, currentValueCents: -25 } }]);
});

test("investment entry deletion authorizes the parent workspace", async () => {
  existingEntry();
  given("investmentEntry.delete", { id: "entry" });
  assert.deepEqual(await responseBody(await removeEntry()), { ok: true });
  assert.deepEqual(dataCalls("investmentEntry.findUnique"), [{ where: { id: "entry" }, select: { account: { select: { workspaceId: true } } } }]);
  assert.deepEqual(accessChecks, [{ workspaceId: "home", minimumRole: "EDITOR" }]);
  assert.deepEqual(dataCalls("investmentEntry.delete"), [{ where: { id: "entry" } }]);
});
