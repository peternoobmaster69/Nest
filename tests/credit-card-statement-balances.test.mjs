import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getOutstandingCreditCardStatements } from "../lib/credit-card-statement-balances.ts";
import { getDaysUntilDue, shouldSendPaymentReminder } from "../lib/credit-card-payment-reminder-schedule.ts";

const date = (day) => new Date(`${day}T00:00:00.000Z`);
const reminderOptions = {
  workspaceId: "home",
  activeOnly: true,
  dueBefore: date("2026-10-11"),
};

function statementDatabase(t, transactions, cards = [{ id: "card", workspaceId: "home", isActive: 1 }]) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    ATTACH DATABASE ':memory:' AS dbo;
    CREATE TABLE dbo.Workspace (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE dbo.CreditCardAccount (
      id TEXT PRIMARY KEY, workspaceId TEXT, cardName TEXT,
      bankName TEXT, last4Digit TEXT, isActive INTEGER
    );
    CREATE TABLE dbo.CreditCardTransaction (
      workspaceId TEXT, creditCardId TEXT, statementMonth INTEGER,
      statementYear INTEGER, amountCents INTEGER, paymentDueDate TEXT
    );
  `);
  for (const workspaceId of new Set(cards.map((card) => card.workspaceId))) {
    sqlite.prepare("INSERT INTO dbo.Workspace VALUES (?, ?)").run(workspaceId, workspaceId);
  }
  for (const card of cards) {
    sqlite.prepare("INSERT INTO dbo.CreditCardAccount VALUES (?, ?, ?, ?, ?, ?)")
      .run(card.id, card.workspaceId, card.id, "Test bank", "1234", card.isActive);
  }
  for (const transaction of transactions) {
    sqlite.prepare("INSERT INTO dbo.CreditCardTransaction VALUES (?, ?, ?, ?, ?, ?)").run(
      transaction.workspaceId ?? "home",
      transaction.cardId ?? "card",
      transaction.month ?? 9,
      transaction.year ?? 2026,
      transaction.cents,
      transaction.due ? date(transaction.due).toISOString() : null,
    );
  }

  return {
    async $queryRaw(query) {
      // Execute the production SQL, adapting only SQL Server's TOP syntax.
      let sql = query.sql;
      const values = query.values.map((value) => value instanceof Date ? value.toISOString() : value);
      if (/SELECT\s+TOP \(\?\)/.test(sql)) {
        sql = sql.replace(/SELECT\s+TOP \(\?\)/, "SELECT") + " LIMIT ?";
        values.push(values.shift());
      }
      return sqlite.prepare(sql).all(...values).map((row) => ({
        ...row,
        paymentDueDate: new Date(row.paymentDueDate),
      }));
    },
  };
}

for (const refundDue of [null, "2026-11-01"]) {
  test(`a refund dated ${refundDue ?? "null"} and partial payment fully settle an overdue statement`, async (t) => {
    const db = statementDatabase(t, [
      { cents: 100_000, due: "2026-10-01" },
      { cents: -30_000, due: refundDue },
      { cents: -70_000, due: "2026-10-03" },
    ]);
    assert.deepEqual(await getOutstandingCreditCardStatements(db, reminderOptions), []);
    assert.deepEqual(await getOutstandingCreditCardStatements(db, { workspaceId: "home", limit: 500 }), []);
  });
}

test("multiple partial payments offset the full statement regardless of their dates", async (t) => {
  const db = statementDatabase(t, [
    { cents: 100_000, due: "2026-10-01" },
    { cents: -20_000, due: null },
    { cents: -30_000, due: "2026-10-04" },
    { cents: -50_000, due: "2026-11-01" },
  ]);
  assert.deepEqual(await getOutstandingCreditCardStatements(db, reminderOptions), []);
});

test("partial settlement keeps the correct remaining amount and the purchase due date", async (t) => {
  const db = statementDatabase(t, [
    { cents: 100_000, due: "2026-10-10" },
    { cents: -20_000, due: "2026-10-01" },
    { cents: -30_000, due: null },
  ]);
  const [statement] = await getOutstandingCreditCardStatements(db, reminderOptions);
  assert.equal(statement.outstandingCents, 50_000);
  assert.deepEqual(statement.paymentDueDate, date("2026-10-10"));
  const days = getDaysUntilDue(statement.paymentDueDate, date("2026-10-06"));
  assert.equal(days, 4);
  assert.equal(shouldSendPaymentReminder(days), false);
});

test("a future-dated credit offsets overdue spend before reminder eligibility is checked", async (t) => {
  const db = statementDatabase(t, [
    { cents: 100_000, due: "2026-10-01" },
    { cents: -40_000, due: "2026-11-01" },
  ]);
  const reminder = await getOutstandingCreditCardStatements(db, reminderOptions);
  const dashboard = await getOutstandingCreditCardStatements(db, { workspaceId: "home", limit: 500 });
  assert.deepEqual(reminder, dashboard);
  assert.equal(reminder[0].outstandingCents, 60_000);
});

test("mixed purchase dates do not truncate the statement amount at the reminder cutoff", async (t) => {
  const db = statementDatabase(t, [
    { cents: 10_000, due: "2026-10-08" },
    { cents: 20_000, due: "2026-10-20" },
    { cents: 5_000, due: null },
    { cents: -4_000, due: "2026-11-01" },
    { cents: 0, due: "2026-09-01" },
  ]);
  const [statement] = await getOutstandingCreditCardStatements(db, reminderOptions);
  assert.equal(statement.outstandingCents, 31_000);
  assert.deepEqual(statement.paymentDueDate, date("2026-10-08"));
});

test("an overpayment produces no payable statement", async (t) => {
  const db = statementDatabase(t, [
    { cents: 10_000, due: "2026-10-01" },
    { cents: -15_000, due: null },
  ]);
  assert.deepEqual(await getOutstandingCreditCardStatements(db), []);
});

test("credits cannot supply a missing purchase due date", async (t) => {
  const db = statementDatabase(t, [
    { cents: 10_000, due: null },
    { cents: -1_000, due: "2026-10-01" },
  ]);
  assert.deepEqual(await getOutstandingCreditCardStatements(db, reminderOptions), []);
});

test("credits are isolated by workspace, card, statement month, and year", async (t) => {
  const db = statementDatabase(t, [
    { cents: 10_000, due: "2026-10-01" },
    { cents: -10_000, due: null, month: 10 },
    { cents: -10_000, due: null, year: 2025 },
    { cents: -10_000, due: null, cardId: "other-card" },
    { cents: -10_000, due: null, workspaceId: "other", cardId: "other-workspace-card" },
    { cents: 5_000, due: "2026-10-01", workspaceId: "other", cardId: "other-workspace-card" },
  ], [
    { id: "card", workspaceId: "home", isActive: 1 },
    { id: "other-card", workspaceId: "home", isActive: 1 },
    { id: "other-workspace-card", workspaceId: "other", isActive: 1 },
  ]);
  const [statement, ...rest] = await getOutstandingCreditCardStatements(db, reminderOptions);
  assert.equal(rest.length, 0);
  assert.equal(statement.workspaceId, "home");
  assert.equal(statement.cardId, "card");
  assert.equal(statement.statementMonth, 9);
  assert.equal(statement.statementYear, 2026);
  assert.equal(statement.outstandingCents, 10_000);
});

test("a payment date cannot pull a future statement into the reminder window", async (t) => {
  const db = statementDatabase(t, [
    { cents: 10_000, due: "2026-10-11" },
    { cents: -1_000, due: "2026-10-01" },
  ]);
  assert.deepEqual(await getOutstandingCreditCardStatements(db, reminderOptions), []);
  const [statement] = await getOutstandingCreditCardStatements(db, { workspaceId: "home" });
  assert.equal(statement.outstandingCents, 9_000);
  assert.deepEqual(statement.paymentDueDate, date("2026-10-11"));
});

test("dashboard limits and channel-specific inactive-card filters still apply", async (t) => {
  const db = statementDatabase(t, [
    { cents: 1_000, due: "2026-10-01", cardId: "inactive" },
    { cents: 2_000, due: "2026-10-03", cardId: "active" },
    { cents: 3_000, due: "2026-10-02", cardId: "other", workspaceId: "other" },
  ], [
    { id: "inactive", workspaceId: "home", isActive: 0 },
    { id: "active", workspaceId: "home", isActive: 1 },
    { id: "other", workspaceId: "other", isActive: 1 },
  ]);
  const dashboard = await getOutstandingCreditCardStatements(db, { workspaceId: "home", limit: 1 });
  assert.deepEqual(dashboard.map((row) => row.cardId), ["inactive"]);
  const reminders = await getOutstandingCreditCardStatements(db, reminderOptions);
  assert.deepEqual(reminders.map((row) => row.cardId), ["active"]);
  const allWorkspaces = await getOutstandingCreditCardStatements(db, { activeOnly: true });
  assert.deepEqual(allWorkspaces.map((row) => row.cardId), ["other", "active"]);
});
