import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv(dotenvPath) {
  if (!fs.existsSync(dotenvPath)) return;
  const content = fs.readFileSync(dotenvPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireValue(value, key) {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function toBooleanString(value, defaultValue) {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === "false" || normalized === "0" ? "false" : "true";
}

function resolveDatabaseUrl(env) {
  const rawDatabaseUrl = env.DATABASE_URL?.trim();
  if (rawDatabaseUrl?.startsWith("sqlserver://")) {
    return rawDatabaseUrl;
  }

  const host = requireValue(rawDatabaseUrl || env.AZURE_SQL_SERVER, "DATABASE_URL or AZURE_SQL_SERVER");
  const database = requireValue(env.AZURE_SQL_DATABASE, "AZURE_SQL_DATABASE");
  const user = requireValue(env.AZURE_SQL_USER, "AZURE_SQL_USER");
  const password = requireValue(env.AZURE_SQL_PASSWORD, "AZURE_SQL_PASSWORD");
  const encrypt = toBooleanString(env.AZURE_SQL_ENCRYPT, "true");
  const trustServerCertificate = toBooleanString(
    env.AZURE_SQL_TRUST_SERVER_CERTIFICATE,
    "false",
  );

  const hostWithPort = host.includes(":") ? host : `${host}:1433`;
  return `sqlserver://${hostWithPort};database=${database};user=${user};password=${password};encrypt=${encrypt};trustServerCertificate=${trustServerCertificate}`;
}

function cents(amount) {
  return Math.round(amount * 100);
}

export async function seedDatabase(prisma) {
  const email = "owner@nest.local";

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Nest Owner",
      },
    });
  }

  let workspace = await prisma.workspace.findFirst({
    where: { name: "Nest Household" },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "Nest Household",
        baseCurrency: "SGD",
      },
    });
  }

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  const monthRows = [
    { year: 2026, month: 1, label: "Jan 2026", sortOrder: 202601 },
    { year: 2026, month: 2, label: "Feb 2026", sortOrder: 202602 },
    { year: 2026, month: 3, label: "Mar 2026", sortOrder: 202603 },
  ];
  for (const month of monthRows) {
    await prisma.month.upsert({
      where: {
        workspaceId_year_month: {
          workspaceId: workspace.id,
          year: month.year,
          month: month.month,
        },
      },
      update: { label: month.label, sortOrder: month.sortOrder, isActive: true },
      create: {
        workspaceId: workspace.id,
        label: month.label,
        year: month.year,
        month: month.month,
        sortOrder: month.sortOrder,
        isActive: true,
      },
    });
  }

  const accountTypeDefs = [
    { label: "Cash", color: "#1A8F58", sortOrder: 1 },
    { label: "Bank", color: "#147349", sortOrder: 2 },
    { label: "Credit Card", color: "#D97706", sortOrder: 3 },
    { label: "Budget Envelope", color: "#3AADA6", sortOrder: 4 },
  ];

  const accountTypes = {};
  for (const t of accountTypeDefs) {
    const row = await prisma.accountType.upsert({
      where: { workspaceId_label: { workspaceId: workspace.id, label: t.label } },
      update: { color: t.color, sortOrder: t.sortOrder, isActive: true },
      create: {
        workspaceId: workspace.id,
        label: t.label,
        color: t.color,
        sortOrder: t.sortOrder,
        isActive: true,
      },
    });
    accountTypes[t.label] = row;
  }

  const accountDefs = [
    {
      name: "Main Checking",
      kind: "BANK",
      accountTypeId: accountTypes["Bank"].id,
      startingCents: cents(3500),
    },
    {
      name: "Envelope Wallet",
      kind: "VIRTUAL_BUDGET",
      accountTypeId: accountTypes["Budget Envelope"].id,
      startingCents: cents(1200),
    },
    {
      name: "Cash Pocket",
      kind: "CASH",
      accountTypeId: accountTypes["Cash"].id,
      startingCents: cents(180),
    },
  ];

  const accounts = {};
  for (const def of accountDefs) {
    const existing = await prisma.financialAccount.findFirst({
      where: { workspaceId: workspace.id, name: def.name },
    });
    const row =
      existing ??
      (await prisma.financialAccount.create({
        data: {
          workspaceId: workspace.id,
          name: def.name,
          kind: def.kind,
          accountTypeId: def.accountTypeId,
          startingCents: def.startingCents,
          isActive: true,
        },
      }));
    accounts[def.name] = row;
  }

  const budgetDefs = [
    { name: "Living", targetCents: cents(1800), availableCents: cents(1245) },
    { name: "Travel", targetCents: cents(1200), availableCents: cents(820) },
    { name: "Invest", targetCents: cents(950), availableCents: cents(950) },
  ];

  const budgets = {};
  for (const b of budgetDefs) {
    const existing = await prisma.budgetEnvelope.findFirst({
      where: {
        workspaceId: workspace.id,
        accountId: accounts["Envelope Wallet"].id,
        name: b.name,
      },
    });
    const data = {
      targetCents: b.targetCents,
      availableCents: b.availableCents,
      isActive: true,
    };
    const row = existing
      ? await prisma.budgetEnvelope.update({ where: { id: existing.id }, data })
      : await prisma.budgetEnvelope.create({
          data: {
            ...data,
            workspaceId: workspace.id,
            accountId: accounts["Envelope Wallet"].id,
            name: b.name,
            createdById: user.id,
          },
        });
    budgets[b.name] = row;
  }

  const expenseTypeDefs = [
    { budget: "Living", label: "Groceries", sortOrder: 1 },
    { budget: "Living", label: "Utilities", sortOrder: 2 },
    { budget: "Travel", label: "Flights", sortOrder: 1 },
    { budget: "Travel", label: "Hotels", sortOrder: 2 },
    { budget: "Invest", label: "Index Funds", sortOrder: 1 },
  ];
  const expenseTypes = {};
  for (const e of expenseTypeDefs) {
    const row = await prisma.expenseType.upsert({
      where: { budgetId_label: { budgetId: budgets[e.budget].id, label: e.label } },
      update: { isActive: true, sortOrder: e.sortOrder },
      create: {
        budgetId: budgets[e.budget].id,
        label: e.label,
        sortOrder: e.sortOrder,
        isActive: true,
      },
    });
    expenseTypes[e.label] = row;
  }

  const txDates = {
    salary: new Date("2026-03-01T10:00:00.000Z"),
    groceries: new Date("2026-03-03T10:00:00.000Z"),
    flight: new Date("2026-03-05T10:00:00.000Z"),
  };

  const existingSalary = await prisma.transaction.findFirst({
    where: { workspaceId: workspace.id, subject: "Salary", date: txDates.salary },
  });
  const salaryTx =
    existingSalary ??
    (await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
        accountId: accounts["Main Checking"].id,
        kind: "INCOME",
        direction: "CREDIT",
        date: txDates.salary,
        amountCents: cents(4800),
        subject: "Salary",
        details: "Monthly salary",
      },
    }));

  const existingGroceries = await prisma.transaction.findFirst({
    where: { workspaceId: workspace.id, subject: "Trader Joe's", date: txDates.groceries },
  });
  const groceriesTx =
    existingGroceries ??
    (await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
        accountId: accounts["Envelope Wallet"].id,
        kind: "EXPENSE",
        direction: "DEBIT",
        date: txDates.groceries,
        amountCents: cents(94),
        subject: "Trader Joe's",
        details: "Weekly groceries",
      },
    }));

  await prisma.expense.upsert({
    where: { transactionId: groceriesTx.id },
    update: { expenseTypeId: expenseTypes["Groceries"].id },
    create: {
      transactionId: groceriesTx.id,
      expenseTypeId: expenseTypes["Groceries"].id,
    },
  });

  const existingFlight = await prisma.transaction.findFirst({
    where: { workspaceId: workspace.id, subject: "Round-trip ticket", date: txDates.flight },
  });
  const flightTx =
    existingFlight ??
    (await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
        accountId: accounts["Envelope Wallet"].id,
        kind: "EXPENSE",
        direction: "DEBIT",
        date: txDates.flight,
        amountCents: cents(420),
        subject: "Round-trip ticket",
        details: "Family trip booking",
      },
    }));

  await prisma.expense.upsert({
    where: { transactionId: flightTx.id },
    update: { expenseTypeId: expenseTypes["Flights"].id },
    create: {
      transactionId: flightTx.id,
      expenseTypeId: expenseTypes["Flights"].id,
    },
  });

  const cc = await prisma.creditCardAccount.findFirst({
    where: { workspaceId: workspace.id, cardName: "Primary Visa" },
  });
  const creditCard =
    cc ??
    (await prisma.creditCardAccount.create({
      data: {
        workspaceId: workspace.id,
        cardName: "Primary Visa",
        bankName: "Bank of Nest",
        last4Digit: "4421",
        statementDay: 25,
        paymentDueDay: 10,
        isActive: true,
      },
    }));

  const existingCcLink = await prisma.creditCardTxnLink.findFirst({
    where: {
      creditCardId: creditCard.id,
      transactionId: flightTx.id,
    },
  });
  if (!existingCcLink) {
    await prisma.creditCardTxnLink.create({
      data: {
        creditCardId: creditCard.id,
        transactionId: flightTx.id,
        cardNameSnapshot: "Primary Visa",
        cardNoEnding: "4421",
        txDate: txDates.flight,
        isProcessed: true,
      },
    });
  }

  const march = await prisma.month.findUnique({
    where: {
      workspaceId_year_month: {
        workspaceId: workspace.id,
        year: 2026,
        month: 3,
      },
    },
  });

  const existingReceivable = await prisma.receivable.findFirst({
    where: { workspaceId: workspace.id, title: "Airbnb Split" },
  });
  if (!existingReceivable) {
    await prisma.receivable.create({
      data: {
        workspaceId: workspace.id,
        accountId: accounts["Main Checking"].id,
        statementMonthId: march?.id,
        title: "Airbnb Split",
        amountCents: cents(250),
        date: new Date("2026-03-06T10:00:00.000Z"),
        status: "OPEN",
        isFamily: true,
        fromUserId: user.id,
      },
    });
  }

  const noteList = await prisma.noteList.findFirst({
    where: { workspaceId: workspace.id, title: "March Planning" },
  });
  const currentNoteList =
    noteList ??
    (await prisma.noteList.create({
      data: {
        workspaceId: workspace.id,
        title: "March Planning",
        subject: "Finance checkpoints",
      },
    }));

  const existingNote = await prisma.note.findFirst({
    where: { workspaceId: workspace.id, title: "Cut dining spend" },
  });
  if (!existingNote) {
    await prisma.note.create({
      data: {
        workspaceId: workspace.id,
        noteListId: currentNoteList.id,
        createdById: user.id,
        title: "Cut dining spend",
        content: "Keep dining budget under $300 for March.",
      },
    });
  }

  const summary = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count(),
    prisma.financialAccount.count(),
    prisma.budgetEnvelope.count(),
    prisma.transaction.count(),
    prisma.receivable.count(),
  ]);

  return {
    userCount: summary[0],
    workspaceCount: summary[1],
    accountCount: summary[2],
    budgetCount: summary[3],
    transactionCount: summary[4],
    receivableCount: summary[5],
    seededWorkspaceId: workspace.id,
    seededUserId: user.id,
    salaryTransactionId: salaryTx.id,
  };
}

async function main() {
  loadDotEnv(path.join(process.cwd(), ".env"));
  const prisma = new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl(process.env) } },
  });
  try {
    console.log(JSON.stringify(await seedDatabase(prisma), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
