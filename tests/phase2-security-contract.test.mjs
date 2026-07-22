import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertProductionConfig } from "../lib/production-config.ts";
import { hasMinimumWorkspaceRole, normalizeWorkspaceRole } from "../lib/workspace-roles.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function handler(source, method) {
  const marker = `export async function ${method}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${method} handler`);
  const end = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
}

test("role ordering implements OWNER, EDITOR, and read-only VIEWER", () => {
  const roles = ["VIEWER", "EDITOR", "OWNER"];
  const expected = {
    VIEWER: { VIEWER: true, EDITOR: false, OWNER: false },
    EDITOR: { VIEWER: true, EDITOR: true, OWNER: false },
    OWNER: { VIEWER: true, EDITOR: true, OWNER: true },
  };
  for (const role of roles) {
    for (const minimum of roles) {
      assert.equal(hasMinimumWorkspaceRole(role, minimum), expected[role][minimum]);
    }
  }
  assert.equal(normalizeWorkspaceRole("MEMBER"), "EDITOR");
  assert.equal(normalizeWorkspaceRole("unexpected"), "VIEWER");
});

test("workspace authorization denies missing and underprivileged memberships", async () => {
  const source = await read("lib/workspace-auth.ts");
  assert.match(source, /const effectiveWorkspaceId = requestedWorkspaceId \|\| requestWorkspaceId/);
  assert.match(source, /workspaceId_userId:\s*\{[\s\S]*workspaceId: effectiveWorkspaceId,[\s\S]*userId/);
  assert.match(source, /if \(!member\) \{\s*throw new ApiAuthError\(403, "Forbidden"\)/);
  assert.match(source, /assertMinimumRole\(role, minimumRole\)/);
  assert.match(source, /requireWorkspaceRole\([\s\S]*minimumRole: WorkspaceRole/);
});

test("all finance mutations require at least EDITOR", async () => {
  const routes = {
    "app/api/accounts/route.ts": ["POST"],
    "app/api/accounts/[id]/route.ts": ["PATCH"],
    "app/api/budgets/route.ts": ["POST"],
    "app/api/budgets/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/budgets/recalculate/route.ts": ["POST"],
    "app/api/budgets/plan/route.ts": ["POST", "PATCH", "DELETE"],
    "app/api/transactions/route.ts": ["POST"],
    "app/api/transactions/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/transactions/transfer/route.ts": ["POST"],
    "app/api/transactions/bulk-import/route.ts": ["POST"],
    "app/api/transaction-groups/route.ts": ["POST"],
    "app/api/transaction-groups/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/receivables/route.ts": ["POST"],
    "app/api/receivables/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/receivables/[id]/close/route.ts": ["POST"],
    "app/api/credit-cards/route.ts": ["POST"],
    "app/api/credit-cards/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/investments/route.ts": ["POST"],
    "app/api/investments/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/investments/[id]/entries/route.ts": ["POST"],
    "app/api/investments/entries/[entryId]/route.ts": ["PATCH", "DELETE"],
    "app/api/credit-alerts/route.ts": ["POST"],
    "app/api/credit-transactions/route.ts": ["POST"],
    "app/api/credit-transactions/[id]/route.ts": ["PATCH", "DELETE"],
    "app/api/credit-transactions/[id]/accounting/route.ts": ["POST"],
    "app/api/credit-transactions/import-maybank/route.ts": ["POST"],
    "app/api/credit-transactions/payments/route.ts": ["POST"],
    "app/api/credit-transactions/payment-due/route.ts": ["PATCH"],
    "app/api/rewards/conversion/route.ts": ["POST", "PATCH", "DELETE"],
    "app/api/rewards/credit-card/route.ts": ["POST", "PATCH", "DELETE"],
    "app/api/rewards/frequent-flyer/route.ts": ["POST", "PATCH", "DELETE"],
    "app/api/rewards/frequent-flyer/history/route.ts": ["POST", "PATCH", "DELETE"],
    "app/api/rewards/hotel-rewards/route.ts": ["POST", "PATCH", "DELETE"],
  };
  for (const [path, methods] of Object.entries(routes)) {
    const source = await read(path);
    for (const method of methods) {
      assert.match(handler(source, method), /requireWorkspace(?:Access|Role)\([^\n]*"EDITOR"\)/, `${path} ${method}`);
    }
  }
});

test("owner-only operations require owner role and recent authentication", async () => {
  const sensitive = await read("lib/workspace-auth.ts");
  assert.match(sensitive, /requireWorkspaceRole\(workspaceId, "OWNER"\)/);
  assert.match(sensitive, /requireRecentAuthentication\(\)/);

  for (const path of [
    "app/api/workspaces/[id]/route.ts",
    "app/api/collaborators/invite/route.ts",
    "app/api/collaborators/[memberId]/route.ts",
    "app/api/collaborators/invites/[inviteId]/route.ts",
    "app/api/public-links/net-worth/route.ts",
  ]) {
    assert.match(await read(path), /requireSensitiveWorkspaceAction/);
  }
  assert.match(await read("app/api/credit-transactions/auto-rules/route.ts"), /requireWorkspaceAccess\(parsed\.data\.workspaceId, "OWNER"\)/);
  assert.match(await read("app/api/passkeys/route.ts"), /DELETE[\s\S]*requireRecentAuthentication/);
  for (const path of ["app/api/gmail/connect/route.ts", "app/api/gmail/disconnect/route.ts", "app/api/gmail/callback/route.ts"]) {
    const source = await read(path);
    assert.match(source, /requireRecentAuthentication|auth:\s*\{\s*minimumRole:\s*"OWNER",\s*recent:\s*true/);
    assert.match(source, /"OWNER"/);
  }
});

test("GET context and workspace discovery do not bootstrap or auto-accept", async () => {
  const context = await read("app/api/context/route.ts");
  const workspaces = await read("app/api/workspaces/route.ts");
  const workspaceAuth = await read("lib/workspace-auth.ts");
  assert.doesNotMatch(handler(context, "GET"), /ensureUserWithDefaultWorkspace|workspaceInvite\.(update|updateMany)|workspaceMember\.(create|upsert)|prisma\.user\.update/);
  assert.doesNotMatch(handler(workspaces, "GET"), /ensureUserWithDefaultWorkspace|\.(create|update|upsert|delete)\(/);
  assert.doesNotMatch(workspaceAuth, /ensureUserWithDefaultWorkspace/);
  assert.match(await read("lib/auth.ts"), /events:[\s\S]*signIn[\s\S]*ensureUserWithDefaultWorkspace/);
});

test("invites use hashed one-time tokens with expiry, explicit response, and revocation", async () => {
  const create = await read("app/api/collaborators/invite/route.ts");
  const respond = await read("app/api/invitations/[token]/route.ts");
  const revoke = await read("app/api/collaborators/invites/[inviteId]/route.ts");
  assert.match(create, /createHash\("sha256"\)/);
  assert.match(create, /tokenHash/);
  assert.match(create, /expiresAt/);
  assert.doesNotMatch(create, /workspaceMember\.(create|upsert)/);
  assert.match(respond, /z\.enum\(\["accept", "decline"\]\)/);
  assert.match(respond, /status: "PENDING"/);
  assert.match(respond, /tokenHash: null/);
  assert.match(respond, /expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(revoke, /status: "REVOKED"/);
  assert.match(revoke, /action: "INVITE_REVOKED"/);
});

test("sessions and public links are revocable and audited", async () => {
  const auth = await read("lib/auth.ts");
  const sessions = await read("app/api/auth/sessions/route.ts");
  const takeover = await read("app/api/auth/session-takeover/route.ts");
  const schema = await read("prisma/schema.prisma");
  const links = await read("app/api/public-links/net-worth/route.ts");
  const context = await read("app/api/context/route.ts");
  assert.match(auth, /storedUser\.sessionVersion !== token\.sessionVersion/);
  assert.match(auth, /token\.takeoverRequired = !claimed/);
  assert.match(auth, /storedUser\.activeSessionId !== token\.sessionId/);
  assert.match(auth, /!token\.takeoverRequired/);
  assert.match(auth, /async signOut\(\{ token \}\)/);
  assert.match(sessions, /sessionVersion: \{ increment: 1 \}/);
  assert.match(sessions, /activeSessionId: null/);
  assert.match(sessions, /action: "SESSIONS_REVOKED"/);
  assert.match(takeover, /getToken\(\{ req: request \}\)/);
  assert.match(takeover, /assertSameOriginRequest\(request\)/);
  assert.match(takeover, /token\.takeoverRequired/);
  assert.match(takeover, /action: "SESSION_REPLACED"/);
  assert.match(schema, /activeSessionId\s+String\?/);
  assert.match(schema, /lastSignedInAt\s+DateTime\?/);
  assert.match(links, /PUBLIC_LINK_CREATED/);
  assert.match(links, /PUBLIC_LINK_ROTATED/);
  assert.match(links, /PUBLIC_LINK_REVOKED/);
  assert.match(links, /publicNetWorthToken: null/);
  assert.match(context, /publicNetWorthToken: isOwner \? workspace\.publicNetWorthToken : null/);
});

test("OAuth accounts are linked only by an authenticated explicit action with verified claims", async () => {
  const auth = await read("lib/auth.ts");
  const settings = await read("components/settings-app-access.tsx");
  assert.doesNotMatch(auth, /allowDangerousEmailAccountLinking/);
  assert.match(auth, /claims\.email_verified === true/);
  assert.match(auth, /claims\.verified === true/);
  assert.match(auth, /async linkAccount/);
  assert.match(settings, /signIn\(provider\.id, \{ callbackUrl: "\/settings" \}\)/);
  assert.match(settings, /never links accounts solely because email addresses match/i);
});

test("production startup rejects missing or unsafe security settings", () => {
  const safe = {
    NODE_ENV: "production",
    NEXTAUTH_URL: "https://nest.example.com",
    NEXTAUTH_SECRET: "a".repeat(32),
    WEBAUTHN_ORIGIN: "https://nest.example.com",
    WEBAUTHN_RP_ID: "nest.example.com",
    CARD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CRON_SECRET: "b".repeat(32),
    DATABASE_URL: "sqlserver://db.example.com:1433;database=nest;encrypt=true;trustServerCertificate=false",
  };
  assert.doesNotThrow(() => assertProductionConfig(safe));
  assert.throws(() => assertProductionConfig({ ...safe, NEXTAUTH_SECRET: "short" }), /NEXTAUTH_SECRET/);
  assert.throws(() => assertProductionConfig({ ...safe, NEXTAUTH_URL: "http://nest.example.com" }), /HTTPS origin/);
  assert.throws(() => assertProductionConfig({ ...safe, DATABASE_URL: safe.DATABASE_URL.replace("encrypt=true", "encrypt=false") }), /encrypt=true/);
});

test("legacy password session and account pages are gone", async () => {
  for (const path of [
    "app/login/page.tsx",
    "app/register/page.tsx",
    "app/api/auth/login/route.ts",
    "app/api/auth/logout/route.ts",
    "app/api/auth/register/route.ts",
    "lib/session.ts",
    "lib/db.ts",
    "app/accounts/page.tsx",
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
  const auth = await read("lib/auth.ts");
  assert.doesNotMatch(auth, /nest-session|allowDangerousEmailAccountLinking/);
});
