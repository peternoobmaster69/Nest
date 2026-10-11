import assert from "node:assert/strict";
import test from "node:test";
import { createCreditTransactionsHarness, cardFixture, creditFixture, creditResponse, deferred } from "./credit-transactions-page-harness.mjs";

const { ui, fixtures, writes, invalidations, setUrl, show, loaded } = await createCreditTransactionsHarness();
const maybank = cardFixture({ id: "maybank-card", cardName: "Maybank card", bankName: "Maybank" });
const prepare = () => {
  setUrl("cardId=maybank-card&month=10&year=2026");
  fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ creditCardId: "maybank-card" })]));
};

test("Maybank import sends the selected file with stable idempotency and shows bounded progress until completion", async t => {
  prepare();
  const pending = deferred();
  t.after(() => pending.resolve(Response.json({ imported: 2, skippedDuplicates: 1, skippedPayments: 3, totalRows: 6 })));
  fixtures.set("POST /api/credit-transactions/import-maybank", () => pending.promise);
  const interval = ui.window.setInterval.bind(ui.window);
  const clearInterval = ui.window.clearInterval.bind(ui.window);
  let tick;
  t.mock.method(ui.window, "setInterval", (callback, delay, ...args) => {
    if (delay === 180) { tick = callback; return 987654; }
    return interval(callback, delay, ...args);
  });
  t.mock.method(ui.window, "clearInterval", id => { if (id !== 987654) clearInterval(id); });
  const view = show([maybank]);
  await loaded(view);
  const fileInput = view.container.querySelector('input[type="file"]');
  const click = t.mock.method(fileInput, "click", () => {});
  ui.fireEvent.click(view.getByRole("button", { name: "Import Maybank CSV" }));
  assert.equal(click.mock.callCount(), 1);
  const csvContent = "Date,Description,Amount\n2026-10-10,Cafe,12.00\n";
  const file = new ui.window.File([csvContent], "statement.csv", { type: "text/csv" });
  ui.fireEvent.change(fileInput, { target: { files: [file] } });
  await view.findByText("Importing CSV 8%");
  assert.equal(view.getByRole("button", { name: "Importing Maybank CSV" }).disabled, true);
  assert.equal(fileInput.disabled, true);
  const write = writes()[0];
  assert.equal(write.body.creditCardId, "maybank-card");
  assert.equal(write.body.csvContent, csvContent);
  assert.match(write.body.importRunId, /^[a-f\d-]{36}$/);
  assert.equal(write.headers.get("idempotency-key"), `maybank:${write.body.importRunId}:0`);
  assert.equal(fileInput.value, "");
  for (let index = 0; index < 25; index += 1) await ui.act(async () => tick());
  const progress = view.getByRole("progressbar");
  const previous = progress.value;
  assert.ok(previous >= 90 && previous < 100);
  await ui.act(async () => tick());
  assert.equal(progress.value, previous);
  await ui.act(async () => pending.resolve(Response.json({ imported: 2, skippedDuplicates: 1, skippedPayments: 3, totalRows: 6 })));
  await view.findByText("Maybank CSV imported: 2 added, 1 duplicates skipped, 3 payment rows skipped.");
  assert.equal(view.getByRole("progressbar").value, 100);
  assert.ok(view.getByText("Import complete"));
  await ui.waitFor(() => assert.ok(!view.queryByRole("progressbar")));
  assert.ok(invalidations.some(({ queryKey }) => queryKey[0] === "credit-transactions"));
});

test("cancelled file selection and unreadable files do not send an import", async () => {
  prepare();
  const view = show([maybank]);
  await loaded(view);
  const input = view.container.querySelector('input[type="file"]');
  ui.fireEvent.change(input, { target: { files: [] } });
  assert.deepEqual(writes(), []);
  ui.fireEvent.change(input, { target: { files: [{ text: async () => { throw new Error("Disk unavailable"); } }] } });
  await view.findByText("Failed to read CSV file.");
  assert.deepEqual(writes(), []);
});

for (const [failure, expected] of [
  [Response.json({ error: "Unsupported CSV columns" }, { status: 422 }), "Unsupported CSV columns"],
  [() => Promise.reject("disconnected"), "Maybank CSV import failed."],
]) {
  test(`an import failure restores the controls and shows ${expected}`, async () => {
    prepare();
    fixtures.set("POST /api/credit-transactions/import-maybank", failure);
    const view = show([maybank]);
    await loaded(view);
    ui.fireEvent.change(view.container.querySelector('input[type="file"]'), { target: { files: [{ text: async () => "csv" }] } });
    await view.findByText(expected);
    assert.equal(view.getByRole("button", { name: "Import Maybank CSV" }).disabled, false);
    assert.equal(writes().length, 1);
  });
}

test("switching to all cards before a pending file selection completes prevents an ambiguous import", async () => {
  prepare();
  const view = show([maybank]);
  await loaded(view);
  const input = view.container.querySelector('input[type="file"]');
  ui.fireEvent.click(view.getByRole("button", { name: /All Cards/ }));
  ui.fireEvent.change(input, { target: { files: [{ text: async () => "csv" }] } });
  await view.findByText("Select a specific card before importing a Maybank CSV.");
  assert.deepEqual(writes(), []);
});
