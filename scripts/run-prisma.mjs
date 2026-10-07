import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "./load-env.mjs";
import { resolveDatabaseUrl } from "../lib/database-config.mjs";

export { loadDotEnv, resolveDatabaseUrl };

export function runPrisma(args, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const env = options.env ?? process.env;
  loadDotEnv(path.join(projectRoot, ".env"), env);
  const resolvedUrl = resolveDatabaseUrl(env);
  const prismaCliPath = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCliPath, ...args], {
    stdio: options.stdio ?? "inherit",
    env: { ...env, DATABASE_URL: resolvedUrl },
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma exited with status ${result.status ?? "unknown"}.`);
  }
  return result;
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  try {
    runPrisma(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
