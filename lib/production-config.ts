type EnvMap = Record<string, string | undefined>;

function required(env: EnvMap, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Production configuration error: ${key} is required.`);
  return value;
}

function canonicalHttpsOrigin(value: string, key: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Production configuration error: ${key} must be a valid URL.`);
  }
  if (url.protocol !== "https:" || url.origin !== value.replace(/\/$/, "")) {
    throw new Error(`Production configuration error: ${key} must be a canonical HTTPS origin.`);
  }
  return url;
}

function assertDatabaseTls(env: EnvMap) {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (databaseUrl.startsWith("sqlserver://")) {
    const normalized = databaseUrl.toLowerCase().replace(/\s/g, "");
    if (!/(^|;)encrypt=true(;|$)/.test(normalized)) {
      throw new Error("Production configuration error: DATABASE_URL must set encrypt=true.");
    }
    if (!/(^|;)trustservercertificate=false(;|$)/.test(normalized)) {
      throw new Error(
        "Production configuration error: DATABASE_URL must set trustServerCertificate=false.",
      );
    }
    return;
  }
  if (required(env, "AZURE_SQL_ENCRYPT").toLowerCase() !== "true") {
    throw new Error("Production configuration error: AZURE_SQL_ENCRYPT must be true.");
  }
  if (required(env, "AZURE_SQL_TRUST_SERVER_CERTIFICATE").toLowerCase() !== "false") {
    throw new Error(
      "Production configuration error: AZURE_SQL_TRUST_SERVER_CERTIFICATE must be false.",
    );
  }
}

export function assertProductionConfig(env: EnvMap = process.env) {
  if (env.NODE_ENV !== "production") return;

  const authSecret = (env.NEXTAUTH_SECRET || env.AUTH_SECRET)?.trim();
  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "Production configuration error: NEXTAUTH_SECRET or AUTH_SECRET must contain at least 32 characters.",
    );
  }

  const appOrigin = canonicalHttpsOrigin(required(env, "NEXTAUTH_URL"), "NEXTAUTH_URL");
  const webAuthnOrigin = canonicalHttpsOrigin(
    required(env, "WEBAUTHN_ORIGIN"),
    "WEBAUTHN_ORIGIN",
  );
  const rpId = required(env, "WEBAUTHN_RP_ID").toLowerCase();
  if (webAuthnOrigin.origin !== appOrigin.origin || webAuthnOrigin.hostname !== rpId) {
    throw new Error(
      "Production configuration error: WebAuthn origin/RP ID must match the canonical application origin.",
    );
  }

  const encryptionKey = (
    env.INTEGRATION_ENCRYPTION_KEY || env.CARD_ENCRYPTION_KEY
  )?.trim();
  if (!encryptionKey) {
    throw new Error(
      "Production configuration error: INTEGRATION_ENCRYPTION_KEY is required.",
    );
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey) || Buffer.from(encryptionKey, "base64").length !== 32) {
    throw new Error(
      "Production configuration error: INTEGRATION_ENCRYPTION_KEY must be exactly 32 bytes encoded as base64.",
    );
  }
  const encryptionKeyVersion = env.INTEGRATION_ENCRYPTION_KEY_VERSION?.trim() || "v1";
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(encryptionKeyVersion)) {
    throw new Error(
      "Production configuration error: INTEGRATION_ENCRYPTION_KEY_VERSION is invalid.",
    );
  }

  if (required(env, "CRON_SECRET").length < 32) {
    throw new Error("Production configuration error: CRON_SECRET must contain at least 32 characters.");
  }
  assertDatabaseTls(env);
}
