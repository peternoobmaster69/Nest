import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const require = createRequire(import.meta.url);
const calls = [];
let session, sessionError, accessError, queryError, alerts;
const retainedBody = '<script>window.untrusted = true</script>\nUnrecognized credit alert';
mock.module("../components/page-frame.tsx", { namedExports: { PageFrame: ({ title, children }) => ui.h("main", { "aria-label": title }, children) } });
mock.module("../lib/require-session.ts", { namedExports: { requireSession: async () => {
  calls.push({ action: "session" });
  if (sessionError) throw sessionError;
  return session;
} } });
mock.module("../lib/workspace-auth.ts", { namedExports: { requireWorkspaceAccess: async (...args) => {
  calls.push({ action: "workspace", args });
  if (accessError) throw accessError;
  return { workspaceId: "household" };
} } });
mock.module("../lib/prisma.ts", { namedExports: { prisma: { cardAlertStaging: { findMany: async (options) => {
  calls.push({ action: "query", options });
  if (queryError) throw queryError;
  return alerts;
} } } } });
mock.module("../lib/credit-alert-diagnostics.ts", { namedExports: { openFailedCreditAlertBody: (options) => {
  calls.push({ action: "diagnostic", options });
  return options.storedBody === "encrypted-retained-sample" ? retainedBody : null;
} } });
const { default: CreditAlertsRoute } = require("../app/credit-alerts/page.tsx");
const { CreditAlertsSkeleton } = require("../components/skeletons/CreditAlertsSkeleton.tsx");
const alert = (overrides = {}) => ({
  id: "alert-one", source: "GMAIL", rawSubject: "Card purchase", rawBody: "private-body", sourceMessageKey: "private-message-key",
  bankName: "DBS", transactionRef: "ref-one", currency: "SGD", amountCents: 1234, transactionDate: new Date("2026-10-09T10:30:00Z"),
  merchant: "Cafe", cardLast4: "1234", parseStatus: "PARSED", failureReason: null, creditTransactionId: "purchase-one",
  createdAt: new Date("2026-10-09T10:31:00Z"), processedAt: null, ...overrides,
});
const columnNames = ["Created", "Status", "Source", "Subject", "Bank", "Card", "Merchant", "Amount", "Txn Date", "Failure"];
beforeEach(() => {
  calls.length = 0;
  session = { user: { name: "Peter", email: "peter@example.test", image: "https://example.test/avatar.png" } };
  sessionError = accessError = queryError = null;
  alerts = [];
});
afterEach(() => ui.cleanup());
after(() => ui.dispose());

test("credit alerts require owner access before querying only the latest 100 rows in that workspace", async () => {
  const view = ui.render(await CreditAlertsRoute());
  assert.deepEqual(calls.map(({ action }) => action), ["session", "workspace", "query"]);
  assert.deepEqual(calls[1].args, [null, "OWNER"]);
  assert.deepEqual(calls[2].options, {
    where: { workspaceId: "household" }, orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, source: true, rawSubject: true, rawBody: true, sourceMessageKey: true, bankName: true, transactionRef: true, currency: true, amountCents: true, transactionDate: true, merchant: true, cardLast4: true, parseStatus: true, failureReason: true, creditTransactionId: true, createdAt: true, processedAt: true },
  });
  assert.ok(view.getByText("Showing 0 most recent staged alerts"));
  assert.equal(view.getAllByText("No staged alerts found.").length, 2);
  const table = view.getByRole("table", { name: "Most recent staged credit alerts and parsing outcomes" });
  const headings = ui.within(table).getAllByRole("columnheader");
  assert.deepEqual(headings.map((heading) => heading.textContent), columnNames);
  assert.ok(headings.every((heading) => heading.getAttribute("scope") === "col"));
  assert.equal(table.querySelector("tbody td").getAttribute("colspan"), "10");
});

test("desktop and mobile alert views show available values, explicit missing values, and status indicators", async () => {
  alerts = [
    alert(),
    alert({ id: "processed", parseStatus: "PROCESSED", merchant: null, bankName: "OCBC", amountCents: 0 }),
    alert({ id: "pending", parseStatus: "PENDING", merchant: null, bankName: null, rawSubject: null, cardLast4: null, amountCents: null, currency: null, transactionDate: null }),
  ];
  const view = ui.render(await CreditAlertsRoute());
  assert.ok(view.getByText("Showing 3 most recent staged alerts"));
  const rows = [...view.getByRole("table").querySelectorAll("tbody tr")];
  assert.equal(rows.length, 3);
  const cells = rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
  assert.deepEqual(cells[0].slice(1, 8), ["PARSED", "GMAIL", "Card purchase", "DBS", "••1234", "Cafe", "$12.34"]);
  assert.ok(cells[0][0] !== "—" && cells[0][8] !== "—");
  assert.equal(cells[1][7], "$0.00");
  assert.deepEqual(cells[2].slice(3), ["—", "—", "—", "—", "—", "—", "—"]);
  const mobile = ui.within(view.container.querySelector(".mobile-data-list"));
  for (const name of ["Cafe", "OCBC", "Card alert"]) assert.ok(mobile.getByText(name));
  for (const status of ["PARSED", "PROCESSED"]) assert.ok(mobile.getByText(status).classList.contains("badge-success"));
  assert.ok(mobile.getByText("PENDING").classList.contains("badge-warning"));
  assert.equal(view.container.querySelectorAll(".privacy-sensitive").length, 6);
  assert.ok(!view.queryByText("View retained body"));
  assert.equal(calls.filter(({ action }) => action === "diagnostic").length, 0);
  assert.ok(!view.container.textContent.includes("private-body"));
  assert.ok(!view.container.textContent.includes("private-message-key"));
});

test("only retained failed samples are opened and their bodies render safely as text in both layouts", async () => {
  alerts = [
    alert({ id: "failed", parseStatus: "FAILED", rawBody: "encrypted-retained-sample", sourceMessageKey: "failed-key", failureReason: "Unrecognized format" }),
    alert({ id: "expired", parseStatus: "FAILED", rawBody: null, sourceMessageKey: "expired-key", failureReason: "Retained sample expired" }),
    alert({ id: "parsed", rawBody: "encrypted-retained-sample" }),
  ];
  const view = ui.render(await CreditAlertsRoute());
  assert.deepEqual(calls.filter(({ action }) => action === "diagnostic").map(({ options }) => options), [
    { workspaceId: "household", sourceMessageKey: "failed-key", storedBody: "encrypted-retained-sample" },
    { workspaceId: "household", sourceMessageKey: "expired-key", storedBody: null },
  ]);
  assert.equal(view.getAllByText("View retained body").length, 2);
  assert.equal(view.getAllByText("Unrecognized format").length, 2);
  assert.equal(view.getAllByText("Retained sample expired").length, 2);
  assert.deepEqual([...view.container.querySelectorAll("pre")].map((element) => element.textContent), [retainedBody, retainedBody]);
  assert.ok(!view.container.querySelector("script"));
  assert.ok(!view.container.textContent.includes("encrypted-retained-sample"));
});

test("a single staged alert uses singular copy and the skeleton preserves its table headings", async () => {
  alerts = [alert()];
  const view = ui.render(await CreditAlertsRoute());
  assert.ok(view.getByText("Showing 1 most recent staged alert"));
  view.unmount();
  const skeleton = ui.render(ui.h(CreditAlertsSkeleton));
  const table = skeleton.getByRole("table", { name: "Loading recent staged credit alerts" });
  assert.deepEqual(ui.within(table).getAllByRole("columnheader").map((heading) => heading.textContent), columnNames);
  assert.equal(table.querySelectorAll("tbody tr").length, 8);
});

test("the alerts route passes authenticated identity and handles absent optional profile fields", async () => {
  for (const [user, expected] of [
    [{ name: "Peter", email: "peter@example.test", image: "https://example.test/avatar.png" }, { userName: "Peter", userEmail: "peter@example.test", userImage: "https://example.test/avatar.png" }],
    [{ name: "", email: "peter@example.test", image: "" }, { userName: "peter@example.test", userEmail: "peter@example.test", userImage: null }],
    [{ name: "", email: "" }, { userName: "User", userEmail: undefined, userImage: null }],
    [undefined, { userName: "User", userEmail: undefined, userImage: null }],
  ]) {
    session = { user };
    const { children, ...props } = (await CreditAlertsRoute()).props;
    assert.deepEqual(props, { title: "Credit Alert Staging", current: "/credit-alerts", ...expected });
    assert.ok(children);
  }
});

test("authentication, owner authorization, and storage failures never reveal staged records", async () => {
  sessionError = new Error("Sign-in required");
  await assert.rejects(CreditAlertsRoute(), (error) => error === sessionError);
  assert.deepEqual(calls.map(({ action }) => action), ["session"]);
  calls.length = 0;
  sessionError = null;
  accessError = new Error("Owner role required");
  await assert.rejects(CreditAlertsRoute(), (error) => error === accessError);
  assert.deepEqual(calls.map(({ action }) => action), ["session", "workspace"]);
  calls.length = 0;
  accessError = null;
  queryError = new Error("Storage unavailable");
  await assert.rejects(CreditAlertsRoute(), (error) => error === queryError);
  assert.deepEqual(calls.map(({ action }) => action), ["session", "workspace", "query"]);
});
