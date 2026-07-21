import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("all scheduler routes use the fail-closed constant-time cron guard", async () => {
  const guard = await source("lib/cron-auth.ts");
  assert.match(guard, /if \(!secret\)[\s\S]*?status: 503/);
  assert.match(guard, /timingSafeEqual\(supplied, expected\)/);
  assert.match(guard, /status: 401/);

  for (const route of [
    "app/api/cron/credit-auto-accounting/route.ts",
    "app/api/cron/credit-card-payment-reminders/route.ts",
    "app/api/cron/gmail-sync/route.ts",
    "app/api/cron/ask-nest-retention/route.ts",
    "app/api/credit-card-payment-reminders/route.ts",
    "app/api/credit-transactions/payment-due/reminders/route.ts",
  ]) {
    const code = await source(route);
    assert.match(code, /authorizeCronRequest\(request\)/, route);
    assert.doesNotMatch(code, /if \(!secret\) return true/, route);
    assert.doesNotMatch(code, /message\s*[,}]/, route);
  }
});

test("cron guard returns 503 when unconfigured, 401 on mismatch, and allows the valid secret", async () => {
  const { authorizeCronRequest } = await import(pathToFileURL(path.join(root, "lib/cron-auth.ts")));
  const previousSecret = process.env.CRON_SECRET;

  try {
    delete process.env.CRON_SECRET;
    assert.deepEqual(authorizeCronRequest(new Request("https://example.test/api/cron")), {
      authorized: false,
      status: 503,
      error: "Scheduler is not configured",
    });

    process.env.CRON_SECRET = "phase-zero-secret";
    assert.equal(authorizeCronRequest(new Request("https://example.test/api/cron", {
      headers: { authorization: "Bearer wrong-secret" },
    })).status, 401);
    assert.deepEqual(authorizeCronRequest(new Request("https://example.test/api/cron", {
      headers: { authorization: "Bearer phase-zero-secret" },
    })), { authorized: true });
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

test("manual auto-accounting is role-protected and filters the runner to one workspace", async () => {
  const route = await source("app/api/credit-transactions/auto-rules/run/route.ts");
  const runner = await source("lib/credit-txn-auto-account-runner.ts");
  const auth = await source("lib/workspace-auth.ts");

  assert.match(route, /RunAutoRulesSchema[\s\S]*?workspaceId/);
  assert.match(route, /requireWorkspaceRole\(parsed\.data\.workspaceId, "EDITOR"\)/);
  assert.match(route, /runCreditTxnAutoAccounting\(prisma, \{ workspaceId \}\)/);
  assert.match(auth, /hasMinimumWorkspaceRole\(role, minimumRole\)/);
  assert.match(runner, /\.\.\.\(workspaceId \? \{ id: workspaceId \} : \{\}\)/);
  assert.match(runner, /workspaceId \? `workspace:\$\{workspaceId\}`/);
});

test("service worker caches static assets only and private read caches are purged on upgrade and logout", async () => {
  const worker = await source("public/sw.js");
  const offline = await source("public/offline.html");
  const logout = await source("lib/service-worker-cache.ts");

  assert.doesNotMatch(worker, /SAFE_READ_PATHS|READ_CACHE/);
  assert.doesNotMatch(worker, /\/api\/context|\/api\/dashboard\/summary|\/api\/notifications/);
  assert.match(worker, /key\.endsWith\("-read"\)/);
  assert.match(worker, /PURGE_PRIVATE_CACHES/);
  assert.match(worker, /OFFLINE_FALLBACK = "\/offline\.html"/);
  assert.doesNotMatch(offline, /\/api\//);
  assert.match(logout, /window\.caches\.delete\(key\)/);
  assert.match(logout, /PURGE_PRIVATE_CACHES/);
});

test("card APIs never accept, persist, or return CVV and card detail reveal is disabled", async () => {
  const collection = await source("app/api/credit-cards/route.ts");
  const detail = await source("app/api/credit-cards/[id]/route.ts");
  const schema = await source("prisma/schema.prisma");
  const migration = await source("prisma/migrations/phase_0_purge_credit_card_cvv/migration.sql");

  for (const code of [collection, detail, schema]) {
    assert.doesNotMatch(code, /securityCode|encryptedSecurityCode|securityCodeIv|securityCodeTag|CVV/);
  }
  assert.doesNotMatch(detail, /fullCardNumber|decryptText/);
  assert.match(detail, /status: 410/);
  assert.match(detail, /"Cache-Control": "no-store"/);
  assert.match(migration, /UPDATE \[CreditCardAccount\][\s\S]*?encryptedSecurityCode[\s\S]*?= NULL/);
  assert.match(migration, /DROP COLUMN \[encryptedSecurityCode\], \[securityCodeIv\], \[securityCodeTag\]/);
});
