import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { readAppStyles } from "./read-app-styles.mjs";
import {
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
} from "../lib/credential-encryption.ts";
import {
  openFailedCreditAlertBody,
  sealFailedCreditAlertBody,
} from "../lib/credit-alert-diagnostics.ts";
import {
  ApiRequestError,
  assertSameOriginRequest,
  parseJsonBody,
} from "../lib/api-security.ts";
import { assertProductionConfig } from "../lib/production-config.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("credential envelopes use versioned authenticated encryption and support rotation", () => {
  const original = {
    key: process.env.INTEGRATION_ENCRYPTION_KEY,
    version: process.env.INTEGRATION_ENCRYPTION_KEY_VERSION,
    previous: process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS,
    legacy: process.env.CARD_ENCRYPTION_KEY,
  };
  try {
    const firstKey = Buffer.alloc(32, 7).toString("base64");
    const secondKey = Buffer.alloc(32, 9).toString("base64");
    process.env.INTEGRATION_ENCRYPTION_KEY = firstKey;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "2026-01";
    delete process.env.CARD_ENCRYPTION_KEY;

    const envelope = encryptCredential("refresh-token-secret", "gmail:workspace:record:refreshToken");
    assert.equal(isEncryptedCredential(envelope), true);
    assert.doesNotMatch(envelope, /refresh-token-secret/);
    assert.equal(
      decryptCredential(envelope, "gmail:workspace:record:refreshToken"),
      "refresh-token-secret",
    );
    assert.throws(
      () => decryptCredential(envelope, "gmail:other-workspace:record:refreshToken"),
      /authenticate data|Unsupported state/i,
    );

    process.env.INTEGRATION_ENCRYPTION_KEY = secondKey;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "2026-07";
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ "2026-01": firstKey });
    assert.equal(
      decryptCredential(envelope, "gmail:workspace:record:refreshToken"),
      "refresh-token-secret",
    );
  } finally {
    for (const [name, value] of Object.entries({
      INTEGRATION_ENCRYPTION_KEY: original.key,
      INTEGRATION_ENCRYPTION_KEY_VERSION: original.version,
      INTEGRATION_ENCRYPTION_PREVIOUS_KEYS: original.previous,
      CARD_ENCRYPTION_KEY: original.legacy,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("failed credit-alert samples are bounded, encrypted, and workspace-bound", () => {
  const original = {
    key: process.env.INTEGRATION_ENCRYPTION_KEY,
    version: process.env.INTEGRATION_ENCRYPTION_KEY_VERSION,
    previous: process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS,
  };
  try {
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "credit-alert-test";
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;

    const rawBody = `Transaction alert\n${"x".repeat(33_000)}`;
    const sourceMessageKey = "message-key";
    const sealed = sealFailedCreditAlertBody({
      workspaceId: "workspace-a",
      sourceMessageKey,
      rawBody,
      contentHash: "content-hash",
    });

    assert.equal(isEncryptedCredential(sealed), true);
    assert.doesNotMatch(sealed, /Transaction alert/);
    const opened = openFailedCreditAlertBody({
      workspaceId: "workspace-a",
      sourceMessageKey,
      storedBody: sealed,
    });
    assert.match(opened ?? "", /^Transaction alert/);
    assert.match(opened ?? "", /\[Diagnostic sample truncated\]$/);
    assert.equal((opened ?? "").length < rawBody.length, true);
    assert.equal(openFailedCreditAlertBody({
      workspaceId: "workspace-b",
      sourceMessageKey,
      storedBody: sealed,
    }), null);
  } finally {
    for (const [name, value] of Object.entries({
      INTEGRATION_ENCRYPTION_KEY: original.key,
      INTEGRATION_ENCRYPTION_KEY_VERSION: original.version,
      INTEGRATION_ENCRYPTION_PREVIOUS_KEYS: original.previous,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("shared API boundary rejects cross-origin requests and enforces JSON body limits", async () => {
  const originalOrigin = process.env.NEXTAUTH_URL;
  try {
    process.env.NEXTAUTH_URL = "https://nest.example.com";
    assert.doesNotThrow(() =>
      assertSameOriginRequest(
        new Request("https://nest.example.com/api/test", {
          method: "POST",
          headers: { origin: "https://nest.example.com" },
        }),
      ),
    );
    assert.throws(
      () =>
        assertSameOriginRequest(
          new Request("https://nest.example.com/api/test", {
            method: "POST",
            headers: { origin: "https://attacker.example" },
          }),
        ),
      (error) => error instanceof ApiRequestError && error.status === 403,
    );

    const schema = z.object({ value: z.string().max(8) }).strict();
    assert.deepEqual(
      await parseJsonBody(
        new Request("https://nest.example.com/api/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "safe" }),
        }),
        schema,
        64,
      ),
      { value: "safe" },
    );
    await assert.rejects(
      parseJsonBody(
        new Request("https://nest.example.com/api/test", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
        schema,
      ),
      (error) => error instanceof ApiRequestError && error.status === 415,
    );
  } finally {
    if (originalOrigin === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalOrigin;
  }
});

test("card persistence retains metadata only and migration destroys legacy PAN fields", async () => {
  const schema = await source("prisma/schema.prisma");
  const collection = await source("app/api/credit-cards/route.ts");
  const detail = await source("app/api/credit-cards/[id]/route.ts");
  const migration = await source("prisma/migrations/phase_3_security_foundation/migration.sql");
  for (const code of [schema, collection, detail]) {
    assert.doesNotMatch(code, /encryptedCardNumber|encryptedHolderName|encryptionIv|encryptionTag/);
  }
  assert.doesNotMatch(collection, /cardNumber/);
  assert.doesNotMatch(detail, /cardNumber/);
  assert.match(collection, /last4Digit: z\.string\(\)\.regex\(\/\^\\d\{4\}\$\//);
  assert.match(migration, /UPDATE \[CreditCardAccount\][\s\S]*encryptedCardNumber[\s\S]*= NULL/);
  assert.match(migration, /DROP COLUMN \[encryptedCardNumber\]/);
});

test("Gmail OAuth state is expiring, one-time, user/workspace-bound, and PKCE-protected", async () => {
  const state = await source("lib/integration-oauth-state.ts");
  const gmail = await source("lib/gmail.ts");
  const callback = await source("app/api/gmail/callback/route.ts");
  const migration = await source("prisma/migrations/phase_3_security_foundation/migration.sql");
  assert.match(state, /randomBytes\(32\).*base64url/);
  assert.match(state, /10 \* 60 \* 1000/);
  assert.match(state, /userId,[\s\S]*workspaceId,[\s\S]*pkceVerifier/);
  assert.match(state, /deleteMany\(\{ where: \{ tokenHash \} \}\)/);
  assert.match(state, /claimed\.count !== 1/);
  assert.match(gmail, /code_challenge: params\.codeChallenge/);
  assert.match(gmail, /code_challenge_method: "S256"/);
  assert.match(gmail, /code_verifier: params\.codeVerifier/);
  assert.match(callback, /oauthState\.userId !== auth\.userId/);
  assert.match(migration, /UPDATE \[GmailIntegration\][\s\S]*\[accessToken\] = NULL[\s\S]*\[isActive\] = 0/);
});

test("Gmail credentials are encrypted, revoked, rate-limited, and errors are redacted", async () => {
  const gmail = await source("lib/gmail.ts");
  const callback = await source("app/api/gmail/callback/route.ts");
  const disconnect = await source("app/api/gmail/disconnect/route.ts");
  const sync = await source("app/api/gmail/sync/route.ts");
  assert.match(callback, /sealGmailCredential/);
  assert.match(gmail, /gmailCredentialContext/);
  assert.match(gmail, /GOOGLE_REVOKE_URL/);
  assert.match(disconnect, /revokeGmailCredential/);
  assert.match(disconnect, /accessToken: null, refreshToken: null/);
  assert.match(sync, /scope: "gmail-sync"/);
  assert.doesNotMatch(gmail, /await res\.text\(\)/);
  assert.doesNotMatch(callback, /message\s*[,}]/);
});

test("security headers, no-store API policy, CSP-safe assets, and CI scanners are configured", async () => {
  const proxy = await source("proxy.ts");
  const layout = await source("app/layout.tsx");
  const css = await readAppStyles();
  const securityWorkflow = await source(".github/workflows/security.yml");
  const codeqlWorkflow = await source(".github/workflows/codeql.yml");
  for (const header of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.match(proxy, new RegExp(header));
  }
  assert.match(proxy, /frame-ancestors 'none'/);
  assert.match(proxy, /Cache-Control", "no-store"/);
  assert.match(proxy, /Vary", "Cookie, Origin"/);
  assert.match(layout, /from "next\/font\/google"/);
  assert.match(layout, /src="\/theme-init\.js"/);
  assert.match(layout, /nonce=\{nonce\}[\s\S]*suppressHydrationWarning/);
  assert.doesNotMatch(layout, /dangerouslySetInnerHTML|fonts\.googleapis\.com/);
  assert.match(css, /--font-dm-sans/);
  assert.match(securityWorkflow, /gitleaks\/gitleaks-action/);
  assert.match(securityWorkflow, /actions\/dependency-review-action/);
  assert.match(codeqlWorkflow, /github\/codeql-action\/analyze@v4/);
});

test("production requires an integration key and verified SQL TLS", () => {
  const safe = {
    NODE_ENV: "production",
    NEXTAUTH_URL: "https://nest.example.com",
    NEXTAUTH_SECRET: "a".repeat(32),
    WEBAUTHN_ORIGIN: "https://nest.example.com",
    WEBAUTHN_RP_ID: "nest.example.com",
    INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
    INTEGRATION_ENCRYPTION_KEY_VERSION: "2026-07",
    CRON_SECRET: "b".repeat(32),
    DATABASE_URL: "sqlserver://db.example.com:1433;database=nest;encrypt=true;trustServerCertificate=false",
  };
  assert.doesNotThrow(() => assertProductionConfig(safe));
  assert.throws(
    () => assertProductionConfig({ ...safe, INTEGRATION_ENCRYPTION_KEY: undefined }),
    /INTEGRATION_ENCRYPTION_KEY/,
  );
  assert.throws(
    () =>
      assertProductionConfig({
        ...safe,
        DATABASE_URL: safe.DATABASE_URL.replace("trustServerCertificate=false", "trustServerCertificate=true"),
      }),
    /trustServerCertificate=false/,
  );
});

test("social sign-in does not retain unused provider API credentials", async () => {
  const auth = await source("lib/auth.ts");
  const migration = await source("prisma/migrations/phase_3_security_foundation/migration.sql");
  assert.match(auth, /async linkAccount[\s\S]*prisma\.account\.updateMany/);
  for (const field of ["access_token", "refresh_token", "id_token", "session_state"]) {
    assert.match(auth, new RegExp(`${field}: null`));
    assert.match(migration, new RegExp(`\\[${field}\\] = NULL`));
  }
});

test("NextAuth database readiness wrapper preserves App Router context", async () => {
  const route = await source("app/api/auth/[...nextauth]/route.ts");
  assert.match(route, /GET\(request: Request, context: NextAuthRouteContext\)/);
  assert.match(route, /POST\(request: Request, context: NextAuthRouteContext\)/);
  assert.equal(route.match(/handler\(request, context\)/g)?.length, 3);
  assert.doesNotMatch(route, /handler\(request\)/);
});
