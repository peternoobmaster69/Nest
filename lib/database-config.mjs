/** @param {string | undefined} value @param {string} key */
function requireValue(value, key) {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

/** @param {string | undefined} value @param {"true" | "false"} defaultValue */
function toBooleanString(value, defaultValue) {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === "false" || normalized === "0" ? "false" : "true";
}

/** @param {Record<string, string | undefined>} env */
export function resolveDatabaseUrl(env = process.env) {
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
