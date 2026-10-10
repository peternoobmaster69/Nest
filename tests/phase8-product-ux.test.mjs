import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("optional telemetry is granular and remains unmounted before consent", async () => {
  const [layout, providers, consent] = await Promise.all([
    source("app/layout.tsx"),
    source("app/providers.tsx"),
    source("components/privacy-consent.tsx"),
  ]);
  assert.doesNotMatch(layout, /<Analytics|<SpeedInsights/);
  assert.match(providers, /PrivacyConsentProvider/);
  assert.match(consent, /consent\.analytics \? <Analytics \/>/);
  assert.match(consent, /consent\.performance \? <SpeedInsights \/>/);
  assert.match(consent, /Essential only/);
  assert.match(consent, /Save choices/);
  assert.match(consent, /Accept optional/);
});

test("Privacy & Security groups sensitive access, storage, export, deletion, and integration controls", async () => {
  const [tabs, settings, gmail, gmailController, privacy, access] = await Promise.all([
    source("components/settings-tabs.tsx"),
    source("components/settings-page.tsx"),
    source("components/settings/gmail-settings-card.tsx"),
    source("hooks/use-gmail-settings.ts"),
    source("components/settings-privacy-controls.tsx"),
    source("components/settings-app-access.tsx"),
  ]);
  assert.match(tabs, /Privacy & Security/);
  assert.match(settings, /Public share links/);
  for (const label of ["Gmail Card Alerts", "Data scope", "Last sync"]) assert.match(gmail, new RegExp(label, "i"));
  for (const label of ["Optional telemetry", "Offline storage", "Export my data", "Delete account"]) assert.match(privacy, new RegExp(label, "i"));
  for (const label of ["Notification devices", "Passkeys", "Active sessions"]) assert.match(access, new RegExp(label, "i"));
  assert.match(settings, /Revoke public share links\?/);
  assert.match(gmailController, /Disconnect Gmail\?/);
});

test("money-changing confirmations expose the decision inputs and reversal behavior", async () => {
  const files = [
    "components/transactions-page.tsx",
    "components/credit-transactions-page.tsx",
    "components/receivables-page.tsx",
    "components/budget-plan-page.tsx",
    "components/dashboard-shell.tsx",
  ];
  const joined = (await Promise.all(files.map(source))).join("\n");
  for (const label of ["Source", "Destination", "Amount", "Date", "Resulting", "reversal"]) {
    assert.match(joined, new RegExp(label, "i"), label);
  }
  assert.match(joined, /workspace:\s*\{\s*name:/);
  assert.match(joined, /immutable compensating/i);
});

test("mutable finance records reject stale writes and provide reload UI", async () => {
  const routes = await Promise.all([
    "app/api/accounts/[id]/route.ts",
    "app/api/receivables/[id]/route.ts",
    "app/api/credit-transactions/[id]/route.ts",
  ].map(source));
  for (const route of routes) {
    assert.match(route, /expectedUpdatedAt/);
    assert.match(route, /updateMany/);
    assert.match(route, /staleWriteResponse/);
  }
  const concurrency = await source("lib/concurrency.ts");
  assert.match(concurrency, /STALE_WRITE/);
  assert.match(concurrency, /status:\s*412/);
  const summary = await source("components/ui/mutation-error-summary.tsx");
  assert.match(summary, /A newer version is available/);
  assert.match(summary, /Reload latest/);
});

test("shareable finance views mirror durable filters into URLs", async () => {
  const hook = await source("lib/use-url-filter-sync.ts");
  assert.match(hook, /router\.replace/);
  assert.match(hook, /new URLSearchParams\(searchParams\.toString\(\)\)/);
  for (const file of [
    "components/transactions-page.tsx",
    "components/credit-transactions-page.tsx",
    "components/receivables-page.tsx",
    "components/rewards-page.tsx",
    "components/investments-page.tsx",
  ]) assert.match(await source(file), /useUrlFilterSync/, file);
});

test("every rendered data table has a caption and scoped column headings", async () => {
  for (const file of [
    "app/credit-alerts/page.tsx",
    "components/skeletons/CreditAlertsSkeleton.tsx",
    "components/admin-record-tables.tsx",
    "components/admin-directories.tsx",
    "components/credit-transactions-page.tsx",
    "components/skeletons/CreditTransactionsSkeleton.tsx",
  ]) {
    const code = await source(file);
    const tables = code.match(/<table\b[\s\S]*?<\/table>/g) ?? [];
    assert.ok(tables.length > 0, `${file} should contain a table`);
    for (const table of tables) {
      assert.match(table, /<caption\b/);
      for (const heading of table.match(/<th\b[^>]*>/g) ?? []) assert.match(heading, /scope="col"/);
    }
  }
});

test("account privacy endpoints require recent authentication and avoid credential export", async () => {
  const [exportRoute, profileRoute] = await Promise.all([
    source("app/api/profile/export/route.ts"),
    source("app/api/profile/route.ts"),
  ]);
  assert.match(exportRoute, /await requireRecentAuthentication\(\)/);
  assert.match(profileRoute.slice(profileRoute.indexOf("export async function DELETE")), /await requireRecentAuthentication\(\)/);
  assert.match(exportRoute, /Content-Disposition/);
  assert.doesNotMatch(exportRoute, /credentialId|publicKey|sessionToken|accessToken|refreshToken/);
  assert.match(profileRoute, /DELETE MY ACCOUNT/);
  assert.match(profileRoute, /SOLE_WORKSPACE_OWNER/);
  assert.match(profileRoute, /ACCOUNT_DELETED/);
});

test("high-contrast, error-summary, and privacy control styles are present", async () => {
  const styles = await source("app/styles/components.css");
  assert.match(styles, /@media \(forced-colors: active\)/);
  assert.match(styles, /\.form-error-summary/);
  assert.match(styles, /\.privacy-consent-options/);
  assert.match(styles, /\.confirm-dialog-details/);
});
