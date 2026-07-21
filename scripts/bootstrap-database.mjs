import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadDotEnv, resolveDatabaseUrl, runPrisma } from "./run-prisma.mjs";

const projectRoot = process.cwd();
const baselineFile = path.join(projectRoot, "prisma", "baseline", "migration.sql");
const historyFile = path.join(projectRoot, "prisma", "baseline", "history.json");
const migrationsRoot = path.join(projectRoot, "prisma", "migrations");

if (!fs.existsSync(baselineFile) || !fs.existsSync(historyFile)) {
  throw new Error("The committed database baseline is incomplete.");
}

loadDotEnv(path.join(projectRoot, ".env"));
const databaseUrl = resolveDatabaseUrl(process.env);
const history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
const historicalMigrations = history.migrations;

if (!Array.isArray(historicalMigrations) || historicalMigrations.some((name) => typeof name !== "string")) {
  throw new Error("prisma/baseline/history.json is invalid.");
}

for (const migration of historicalMigrations) {
  if (!fs.existsSync(path.join(migrationsRoot, migration, "migration.sql"))) {
    throw new Error(`Baseline history references missing migration: ${migration}`);
  }
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS [tableCount]
    FROM sys.tables
    WHERE [is_ms_shipped] = 0
  `;
  const tableCount = Number(rows[0]?.tableCount ?? 0);
  if (tableCount !== 0) {
    throw new Error(`Database bootstrap requires an empty database; found ${tableCount} user table(s).`);
  }
} finally {
  await prisma.$disconnect();
}

console.log("Applying committed SQL Server baseline...");
runPrisma(["db", "execute", "--file", baselineFile]);

console.log(`Recording ${historicalMigrations.length} retained historical migrations...`);
for (const migration of historicalMigrations) {
  runPrisma(["migrate", "resolve", "--applied", migration]);
}

console.log("Deploying forward migrations...");
runPrisma(["migrate", "deploy"]);
console.log("Database bootstrap complete.");
