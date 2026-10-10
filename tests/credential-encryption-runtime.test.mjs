import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  decryptCredential, encryptCredential, gmailCredentialContext, isEncryptedCredential, oauthVerifierContext,
} from "../lib/credential-encryption.ts";

const environmentNames = ["INTEGRATION_ENCRYPTION_KEY", "INTEGRATION_ENCRYPTION_KEY_VERSION", "INTEGRATION_ENCRYPTION_PREVIOUS_KEYS", "CARD_ENCRYPTION_KEY"];
const firstKey = Buffer.alloc(32, 17).toString("base64");
const secondKey = Buffer.alloc(32, 19).toString("base64");
const context = "gmail:fixture-workspace:fixture-integration:refreshToken";
beforeEach((t) => {
  const original = new Map(environmentNames.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of environmentNames) delete process.env[name];
  process.env.INTEGRATION_ENCRYPTION_KEY = firstKey;
  process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "fixture-v1";
});

test("credential envelopes use unique nonces and authenticate the plaintext and record context", () => {
  const first = encryptCredential("fixture-credential", context);
  const second = encryptCredential("fixture-credential", context);
  assert.notEqual(first, second);
  assert.ok(isEncryptedCredential(first));
  assert.ok(!isEncryptedCredential("unencrypted-value"));
  assert.ok(!first.includes("fixture-credential"));
  assert.equal(decryptCredential(first, context), "fixture-credential");
  assert.equal(decryptCredential(second, context), "fixture-credential");
  assert.throws(() => decryptCredential(first, "gmail:other:fixture-integration:refreshToken"));
  assert.throws(() => decryptCredential(first, "gmail:fixture-workspace:fixture-integration:accessToken"));
  for (const index of [3, 4, 5]) {
    const parts = first.split(":");
    const bytes = Buffer.from(parts[index], "base64url");
    bytes[0] ^= 1;
    parts[index] = bytes.toString("base64url");
    assert.throws(() => decryptCredential(parts.join(":"), context));
  }
  process.env.INTEGRATION_ENCRYPTION_KEY = secondKey;
  assert.throws(() => decryptCredential(first, context));
});

test("key rotation reads the original version while new envelopes use the current key", () => {
  const envelope = encryptCredential("fixture-credential", context);
  process.env.INTEGRATION_ENCRYPTION_KEY = ` ${secondKey} `;
  process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = " fixture-v2 ";
  process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ "fixture-v1": firstKey });
  assert.equal(decryptCredential(envelope, context), "fixture-credential");
  const updated = encryptCredential("next-credential", context);
  assert.match(updated, /^enc:v1:fixture-v2:/);
  assert.equal(decryptCredential(updated, context), "next-credential");
});

test("legacy key fallback and omitted or blank versions still produce authenticated v1 envelopes", () => {
  for (const primary of [undefined, "  "]) {
    if (primary === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = primary;
    process.env.CARD_ENCRYPTION_KEY = ` ${firstKey} `;
    for (const version of [undefined, " "]) {
      if (version === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_VERSION;
      else process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = version;
      const envelope = encryptCredential("fixture-credential", context);
      assert.match(envelope, /^enc:v1:v1:/);
      assert.equal(decryptCredential(envelope, context), "fixture-credential");
    }
  }
});

test("empty credentials, missing keys, invalid versions and incorrectly sized keys fail explicitly", () => {
  assert.throws(() => encryptCredential("", context), /Cannot encrypt an empty credential/);
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  assert.throws(() => encryptCredential("fixture", context), /encryption is not configured/);
  process.env.CARD_ENCRYPTION_KEY = " ";
  assert.throws(() => encryptCredential("fixture", context), /encryption is not configured/);
  process.env.INTEGRATION_ENCRYPTION_KEY = firstKey;
  for (const version of ["invalid:version", "x".repeat(41)]) {
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = version;
    assert.throws(() => encryptCredential("fixture", context), /KEY_VERSION is invalid/);
  }
  process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "fixture-v1";
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
  assert.throws(() => encryptCredential("fixture", context), /exactly 32 bytes/);
});

test("rotated credentials reject unavailable, malformed and incorrectly typed previous keys", () => {
  const envelope = encryptCredential("fixture", context);
  process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "fixture-v2";
  assert.throws(() => decryptCredential(envelope, context), /No integration encryption key is available for fixture-v1/);
  process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = "not-json";
  assert.throws(() => decryptCredential(envelope, context), /must be valid JSON/);
  for (const invalid of [null, true, "text", [], 123]) {
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify(invalid);
    assert.throws(() => decryptCredential(envelope, context), { name: "TypeError", message: "INTEGRATION_ENCRYPTION_PREVIOUS_KEYS must be a JSON object." });
  }
  for (const invalid of [{}, { "fixture-v1": null }, { "fixture-v1": 123 }]) {
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify(invalid);
    assert.throws(() => decryptCredential(envelope, context), { name: "TypeError", message: "No integration encryption key is available for fixture-v1." });
  }
  process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ "fixture-v1": "short" });
  assert.throws(() => decryptCredential(envelope, context), /Integration encryption key fixture-v1 must be exactly 32 bytes/);
});

test("stored envelopes require the supported format and every encrypted field without extra fields", () => {
  const envelope = encryptCredential("fixture", context);
  for (const malformed of [
    "plaintext", envelope.replace("enc:", "other:"), envelope.replace("enc:v1:", "enc:v2:"),
    ...[2, 3, 4, 5].map((index) => { const parts = envelope.split(":"); parts[index] = ""; return parts.join(":"); }),
    `${envelope}:extra`,
  ]) {
    assert.throws(() => decryptCredential(malformed, context), /Stored integration credential is not encrypted/);
  }
});

test("credential contexts distinguish workspaces, integration records, token fields and OAuth verifiers", () => {
  assert.equal(gmailCredentialContext("fixture-integration", "fixture-workspace", "refreshToken"), context);
  assert.equal(gmailCredentialContext("fixture-integration", "fixture-workspace", "accessToken"), "gmail:fixture-workspace:fixture-integration:accessToken");
  assert.equal(oauthVerifierContext("fixture-hash"), "oauth-state:fixture-hash:pkce");
});
