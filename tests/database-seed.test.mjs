import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { seedDatabase } from "../prisma/seed.mjs";

// Validate the seed's inputs against the generated schema, without a database connection.
function createSeedDatabase() {
  const tables = new Map();
  const database = {};
  let sequence = 0;
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = [];
    tables.set(model.name, table);
    const fields = new Map(model.fields.map((field) => [field.name, field]));
    const uniqueFields = model.fields.filter((field) => field.isId || field.isUnique).map((field) => field.name);
    const compoundFields = new Map(model.uniqueFields.map((names) => [names.join("_"), names]));

    function predicate(where = {}, requireUnique = false) {
      if (requireUnique) {
        assert.ok(Object.keys(where).some((key) => uniqueFields.includes(key) || compoundFields.has(key)), `${model.name} requires a real unique key`);
      }
      const conditions = [];
      for (const [key, value] of Object.entries(where)) {
        if (compoundFields.has(key)) {
          conditions.push(...Object.entries(value));
        } else {
          assert.ok(fields.has(key), `${model.name}.${key} does not exist in the Prisma schema`);
          conditions.push([key, value]);
        }
      }
      return (row) => conditions.every(([key, value]) => {
        if (value === undefined) return true;
        if (value instanceof Date) return row[key]?.getTime() === value.getTime();
        return row[key] === value;
      });
    }

    async function create({ data }) {
      for (const key of Object.keys(data)) assert.ok(fields.has(key), `${model.name}.${key} is not a field`);
      for (const field of model.fields) {
        if (field.kind !== "object" && field.isRequired && !field.hasDefaultValue && !field.isUpdatedAt) {
          assert.notEqual(data[field.name], undefined, `${model.name}.${field.name} is required`);
        }
      }
      const row = { id: `seed-${++sequence}`, ...structuredClone(data) };
      table.push(row);
      return row;
    }

    const api = {
      create,
      count: async () => table.length,
      findFirst: async ({ where }) => table.find(predicate(where)) ?? null,
      findUnique: async ({ where }) => table.find(predicate(where, true)) ?? null,
      update: async ({ where, data }) => {
        const row = table.find(predicate(where, true));
        assert.ok(row, `${model.name} update requires an existing row`);
        Object.assign(row, structuredClone(data));
        return row;
      },
      upsert: async ({ where, create: data, update }) => {
        const row = table.find(predicate(where, true));
        if (!row) return create({ data });
        Object.assign(row, structuredClone(update));
        return row;
      },
    };
    database[model.name[0].toLowerCase() + model.name.slice(1)] = api;
  }
  return { database, tables };
}

test("a fresh seed satisfies the current schema and creates linked financial examples", async () => {
  const { database, tables } = createSeedDatabase();
  const result = await seedDatabase(database);
  assert.deepEqual(
    [result.userCount, result.workspaceCount, result.accountCount, result.budgetCount, result.transactionCount, result.receivableCount],
    [1, 1, 3, 3, 3, 1],
  );
  const wallet = tables.get("FinancialAccount").find((row) => row.name === "Envelope Wallet");
  const budgets = tables.get("BudgetEnvelope");
  assert.deepEqual(budgets.map((row) => row.name), ["Living", "Travel", "Invest"]);
  assert.ok(budgets.every((row) => row.accountId === wallet.id && row.workspaceId === result.seededWorkspaceId));
  const salary = tables.get("Transaction").find((row) => row.id === result.salaryTransactionId);
  assert.equal(salary.amountCents, 480_000);
  assert.equal(salary.direction, "CREDIT");
  const flightLink = tables.get("CreditCardTxnLink")[0];
  const flight = tables.get("Transaction").find((row) => row.id === flightLink.transactionId);
  assert.equal(flight.subject, "Round-trip ticket");
  assert.equal(flight.amountCents, 42_000);
  const receivable = tables.get("Receivable")[0];
  const month = tables.get("Month").find((row) => row.id === receivable.statementMonthId);
  assert.equal(month.label, "Mar 2026");
  assert.equal(receivable.amountCents, 25_000);
});

test("re-running the seed keeps stable identities and does not duplicate records", async () => {
  const { database, tables } = createSeedDatabase();
  const first = await seedDatabase(database);
  const counts = Array.from(tables, ([name, rows]) => [name, rows.length]);
  const living = tables.get("BudgetEnvelope").find((row) => row.name === "Living");
  living.targetCents = 1;
  living.isActive = false;
  const second = await seedDatabase(database);
  assert.deepEqual(second, first);
  assert.deepEqual(Array.from(tables, ([name, rows]) => [name, rows.length]), counts);
  assert.equal(living.targetCents, 180_000);
  assert.equal(living.isActive, true);
});

test("same-named budgets under another account are left untouched", async () => {
  const { database, tables } = createSeedDatabase();
  const first = await seedDatabase(database);
  const checking = tables.get("FinancialAccount").find((row) => row.name === "Main Checking");
  const other = await database.budgetEnvelope.create({ data: {
    workspaceId: first.seededWorkspaceId,
    accountId: checking.id,
    name: "Living",
    targetCents: 42,
    createdById: first.seededUserId,
  } });
  // Put it first so an unscoped lookup would choose the wrong budget.
  tables.get("BudgetEnvelope").unshift(tables.get("BudgetEnvelope").pop());
  await seedDatabase(database);
  assert.equal(other.targetCents, 42);
  assert.equal(tables.get("BudgetEnvelope").length, 4);
});
