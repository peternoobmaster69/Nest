import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_PREFIX = "enc:v1";
const KEY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

function decodeKey(value: string, label: string) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error(`${label} must be exactly 32 bytes encoded as base64.`);
  }
  return key;
}

function currentKey() {
  const encoded =
    process.env.INTEGRATION_ENCRYPTION_KEY?.trim() ||
    process.env.CARD_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("Integration credential encryption is not configured.");

  const version = process.env.INTEGRATION_ENCRYPTION_KEY_VERSION?.trim() || "v1";
  if (!KEY_VERSION_PATTERN.test(version)) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY_VERSION is invalid.");
  }
  return { version, key: decodeKey(encoded, "INTEGRATION_ENCRYPTION_KEY") };
}

function keyForVersion(version: string) {
  const current = currentKey();
  if (current.version === version) return current.key;

  const encodedPrevious = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS?.trim();
  if (!encodedPrevious) throw new Error(`No integration encryption key is available for ${version}.`);

  let previous: unknown;
  try {
    previous = JSON.parse(encodedPrevious);
  } catch {
    throw new Error("INTEGRATION_ENCRYPTION_PREVIOUS_KEYS must be valid JSON.");
  }
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
    throw new TypeError("INTEGRATION_ENCRYPTION_PREVIOUS_KEYS must be a JSON object.");
  }
  const encoded = (previous as Record<string, unknown>)[version];
  if (typeof encoded !== "string") {
    throw new TypeError(`No integration encryption key is available for ${version}.`);
  }
  return decodeKey(encoded, `Integration encryption key ${version}`);
}

export function isEncryptedCredential(value: string) {
  return value.startsWith(`${ENVELOPE_PREFIX}:`);
}

export function encryptCredential(value: string, context: string) {
  if (!value) throw new Error("Cannot encrypt an empty credential.");
  const { version, key } = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    version,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptCredential(envelope: string, context: string) {
  const [prefix, format, version, ivValue, tagValue, ciphertextValue, ...extra] =
    envelope.split(":");
  if (
    prefix !== "enc" ||
    format !== "v1" ||
    !version ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue ||
    extra.length > 0
  ) {
    throw new Error("Stored integration credential is not encrypted.");
  }

  const decipher = createDecipheriv("aes-256-gcm", keyForVersion(version), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function gmailCredentialContext(
  integrationId: string,
  workspaceId: string,
  field: "accessToken" | "refreshToken",
) {
  return `gmail:${workspaceId}:${integrationId}:${field}`;
}

export function oauthVerifierContext(tokenHash: string) {
  return `oauth-state:${tokenHash}:pkce`;
}
