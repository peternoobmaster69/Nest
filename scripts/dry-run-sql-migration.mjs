import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadDotEnv, resolveDatabaseUrl } from "./run-prisma.mjs";

const requestedPath = process.argv[2];
if (!requestedPath) {
  throw new Error("Usage: node scripts/dry-run-sql-migration.mjs <migration.sql>");
}

const root = process.cwd();
const migrationPath = path.resolve(root, requestedPath);
const migrationsRoot = `${path.resolve(root, "prisma", "migrations")}${path.sep}`;
if (!migrationPath.startsWith(migrationsRoot) || path.basename(migrationPath) !== "migration.sql") {
  throw new Error("The migration must be a migration.sql file under prisma/migrations.");
}

loadDotEnv(path.join(root, ".env"));
const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl(process.env) });

try {
  const sql = await fs.readFile(migrationPath, "utf8");
  const commits = sql.match(/COMMIT TRANSACTION;/g) ?? [];
  if (commits.length !== 1 || !sql.includes("BEGIN TRANSACTION;")) {
    throw new Error("Dry-run requires exactly one explicit BEGIN/COMMIT transaction pair.");
  }
  const dryRunSql = sql.replace("COMMIT TRANSACTION;", "ROLLBACK TRANSACTION;");
  await prisma.$executeRawUnsafe(dryRunSql);
  console.log(`${path.relative(root, migrationPath)} passed SQL Server execution validation and was rolled back.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
