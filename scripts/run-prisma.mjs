import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function loadDotEnv(dotenvPath) {
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
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function toBooleanString(value, defaultValue) {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === "false" || normalized === "0" ? "false" : "true";
}

export function resolveDatabaseUrl(env) {
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

export function runPrisma(args, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  loadDotEnv(path.join(projectRoot, ".env"));
  const resolvedUrl = resolveDatabaseUrl(process.env);
  const prismaCliPath = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCliPath, ...args], {
    stdio: options.stdio ?? "inherit",
    env: { ...process.env, DATABASE_URL: resolvedUrl },
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
