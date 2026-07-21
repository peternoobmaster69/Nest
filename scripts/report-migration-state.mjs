import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadDotEnv, resolveDatabaseUrl } from "./run-prisma.mjs";

loadDotEnv(path.join(process.cwd(), ".env"));
const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl(process.env) });

try {
  const rows = await prisma.$queryRaw`
    SELECT [migration_name], [started_at], [finished_at], [rolled_back_at], [applied_steps_count], [logs]
    FROM [dbo].[_prisma_migrations]
    ORDER BY [started_at] DESC
  `;

  for (const row of rows) {
    const state = row.rolled_back_at ? "ROLLED_BACK" : row.finished_at ? "APPLIED" : "FAILED";
    console.log(`${state.padEnd(11)} ${row.migration_name} started=${row.started_at?.toISOString?.() ?? row.started_at}`);
    if (state === "FAILED" && row.logs) {
      console.log(String(row.logs).slice(0, 4_000));
    }
  }
} finally {
  await prisma.$disconnect();
}
