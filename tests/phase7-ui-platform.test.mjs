import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readAppStyles } from "./read-app-styles.mjs";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const child = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  }))).flat();
}

test("Phase 7 keeps the shipped mobile popup width and anti-overlap contract", async () => {
  const [styles, transactions, investments] = await Promise.all([
    readAppStyles(root),
    source("components/transactions-page.tsx"),
    source("components/investments-page.tsx"),
  ]);
  const contract = styles.slice(styles.indexOf("COMPACT FORM + DIALOG CONTRACT"));
  assert.match(contract, /--mobile-modal-inline-size:\s*calc\([\s\S]*?100vw/);
  assert.match(contract, /body \.profile-modal\.txn-modal\.txn-entry-modal\[class\][\s\S]*?width:\s*100%\s*!important/);
  assert.match(contract, /\.inv-modal,[\s\S]*?width:\s*var\(--mobile-modal-inline-size\)\s*!important/);
  assert.match(contract, /@media \(max-width: 599px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/);
  assert.equal((transactions.match(/profile-modal txn-modal txn-entry-modal/g) ?? []).length, 2);
  assert.equal((investments.match(/className="profile-modal inv-modal"/g) ?? []).length, 2);
});

test("all feature actions, fields, and modal families use shared primitives", async () => {
  const files = (await walk("components")).filter((file) => file.endsWith(".tsx") && !file.startsWith("components/ui/"));
  for (const file of files) {
    const code = await source(file);
    assert.doesNotMatch(code, /<(?:button|input|select|textarea)\b/, file);
    assert.doesNotMatch(code, /<div[^>]+(?:modal|popover|signin)-overlay/, file);
  }
  assert.equal(existsSync(path.join(root, "components/modal-viewport-manager.tsx")), false);
  const dialog = await source("components/ui/dialog.tsx");
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /previousFocus\?\.focus\(\)/);
  assert.match(dialog, /function lockViewport\(\)/);
});

test("UI styles are layered, token guarded, and materially smaller globally", async () => {
  const globals = await source("app/globals.css");
  assert.ok(globals.split(/\r?\n/).length < 100);
  for (const layer of ["tokens", "base", "features", "components", "utilities"]) {
    assert.match(globals, new RegExp(`styles/${layer}\\.css`));
  }
  const tokens = await source("app/styles/tokens.css");
  assert.match(tokens, /--touch-target-min:\s*44px/);
  assert.match(tokens, /--focus-ring-color:/);
  assert.match(tokens, /--duration-base:/);
});

test("priority route controllers have focused feature extractions and lazy heavy UI", async () => {
  const [transactions, rewards, dashboard, creditTransactions, settings] = await Promise.all([
    source("components/transactions-page.tsx"),
    source("components/rewards-page.tsx"),
    source("components/dashboard-shell.tsx"),
    source("components/credit-transactions-page.tsx"),
    source("components/settings-page.tsx"),
  ]);
  assert.match(transactions, /TransactionMonthList/);
  assert.match(rewards, /RewardsOverview/);
  assert.match(dashboard, /dynamic\([\s\S]*?cash-flow-chart/);
  assert.match(creditTransactions, /CreditTransactionSummaryView/);
  assert.match(settings, /dynamic\([\s\S]*?data-import-section/);
  assert.match(settings, /dynamic\([\s\S]*?auto-rule-editor-dialog/);
  assert.match(settings, /SettingsOperationNotice/);
});

test("bank-account management and data shape have one canonical UI contract", async () => {
  const [config, workspaceRoute, settings, accounts] = await Promise.all([
    source("next.config.ts"),
    source("app/w/[workspaceId]/[[...path]]/page.tsx"),
    source("components/settings-page.tsx"),
    source("lib/accounts.ts"),
  ]);
  assert.match(config, /\/accounts\/:path\*[\s\S]*?\/settings\?tab=workspaces#bank-accounts/);
  assert.match(workspaceRoute, /case "accounts"[\s\S]*?settings\?tab=workspaces#bank-accounts/);
  assert.match(settings, /id="bank-accounts"/);
  assert.match(accounts, /export type BankAccount/);
  assert.match(accounts, /bankAccountsQueryOptions/);
  for (const file of ["transactions-page.tsx", "dashboard-shell.tsx", "settings-page.tsx", "credit-transactions-page.tsx"]) {
    assert.doesNotMatch(await source(`components/${file}`), /^type BankAccount/m, file);
  }
});

test("investment entry mutations update the visible card cache before reconciliation", async () => {
  const investments = await source("components/investments-page.tsx");
  assert.match(investments, /const investmentsQueryKey = queryKeys\.investments\(workspaceId\)/);
  assert.match(
    investments,
    /const updateEntry = useMutation\([\s\S]*?onSuccess: \(updated\)[\s\S]*?setQueryData<InvestmentAccount\[]>\(investmentsQueryKey[\s\S]*?entry\.id === updated\.id \? updated : entry[\s\S]*?reconcileInvestments\(\)/,
  );
});

test("route states, query invalidation, and runtime performance reporting are predictable", async () => {
  for (const file of [
    "app/loading.tsx",
    "app/error.tsx",
    "app/not-found.tsx",
    "app/transactions/loading.tsx",
    "app/transactions/error.tsx",
    "app/settings/loading.tsx",
    "app/settings/error.tsx",
  ]) assert.equal(existsSync(path.join(root, file)), true, file);

  const componentFiles = (await walk("components")).filter((file) => file.endsWith(".tsx"));
  for (const file of componentFiles) assert.doesNotMatch(await source(file), /queryKey:\s*\[/, file);
  assert.match(await source("lib/query-keys.ts"), /invalidateWorkspaceQueries/);
  assert.match(await source("lib/api/client.ts"), /classifyMutationFailure[\s\S]*?"offline"[\s\S]*?"permission"[\s\S]*?"conflict"[\s\S]*?"stale"/);
  assert.match(await source("components/web-vitals-reporter.tsx"), /useReportWebVitals/);
  assert.match(await source("scripts/report-ui-performance.mjs"), /1\.05/);
});

test("local fonts reserve rendering without external stylesheet links", async () => {
  const layout = await source("app/layout.tsx");
  assert.match(layout, /DM_Mono, DM_Sans.*from "next\/font\/google"/);
  assert.doesNotMatch(layout, /fonts\.googleapis\.com|<link/);
  assert.match(await readAppStyles(root), /contain-intrinsic-size/);
});
