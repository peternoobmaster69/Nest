import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const root = process.cwd();

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : target;
  }));
  return files.flat();
}

test("shared UI primitives remain available", async () => {
  const required = [
    "components/app-shell.tsx",
    "components/notification-bell.tsx",
    "components/ui/button.tsx",
    "components/ui/dialog.tsx",
    "components/ui/form-field.tsx",
    "components/ui/page-header.tsx",
    "components/ui/query-state.tsx",
    "components/ui/data-view.tsx",
    "components/toast-provider.tsx",
  ];

  await Promise.all(required.map(async (file) => {
    const source = await readFile(path.join(root, file), "utf8");
    assert.ok(source.length > 0, `${file} should not be empty`);
  }));
});

test("feature UI does not regress to blocking browser confirms or double-click dismissal", async () => {
  const files = (await walk(path.join(root, "components"))).filter((file) => file.endsWith(".tsx"));
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));

  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /(?:window\.)?confirm\s*\(\s*["'`]/, `${path.relative(root, file)} uses a blocking browser confirmation`);
    assert.doesNotMatch(source, /onDoubleClick=/, `${path.relative(root, file)} uses double-click dismissal`);
  }
});

test("authenticated feature routes use the shared shell", async () => {
  const routes = [
    "app/transactions/page.tsx",
    "app/receivables/page.tsx",
    "app/investments/page.tsx",
    "app/credit-cards/page.tsx",
    "app/credit-transactions/page.tsx",
    "app/credit-alerts/page.tsx",
    "app/rewards/page.tsx",
    "app/settings/page.tsx",
    "app/collaborators/page.tsx",
    "app/budgets/plan/page.tsx",
    "app/accounts/page.tsx",
  ];

  for (const route of routes) {
    const source = await readFile(path.join(root, route), "utf8");
    assert.match(source, /<PageFrame\b/, `${route} must render PageFrame`);
  }
});

test("application routes do not duplicate page names with body headers", async () => {
  const files = (await walk(path.join(root, "app"))).filter((file) => file.endsWith(".tsx"));
  const sources = await Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));

  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /<PageHeader\b/, `${path.relative(root, file)} renders a redundant body page header`);
  }
});

test("sidebar does not link to the redundant accounts route", async () => {
  const source = await readFile(path.join(root, "components/app-sidebar.tsx"), "utf8");

  assert.doesNotMatch(source, /href=["']\/accounts["']/);
});

test("sidebar does not expose the credit alert diagnostics route", async () => {
  const source = await readFile(path.join(root, "components/app-sidebar.tsx"), "utf8");

  assert.doesNotMatch(source, /href=["']\/credit-alerts["']/);
});

test("mobile editable controls do not trigger viewport focus zoom", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.match(source, /\(hover:\s*none\)\s+and\s+\(pointer:\s*coarse\)/);
  assert.match(
    source,
    /input:not\(\[type="checkbox"\]\)[\s\S]*?\[contenteditable\][\s\S]*?font-size:\s*16px\s*!important/,
  );
});

test("credit transaction records use a compact mobile card layout", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");

  assert.doesNotMatch(source, /\.cct-table td\s*\{[^}]*height:\s*56\.5px/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-subject\s*\{[^}]*grid-row:\s*1/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-amount\s*\{[^}]*grid-row:\s*1/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-tx-card\s*\{[^}]*grid-row:\s*2/s);
  assert.match(source, /\.cct-table\.responsive-data-table \.cct-action-btn\s*\{[^}]*height:\s*40px/s);
});

test("all modal families use the centered viewport contract", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");
  const contract = source.slice(source.indexOf("MODAL VIEWPORT CONTRACT"));

  for (const selector of [
    ".modal-overlay",
    ".profile-modal-overlay",
    ".cc-modal-overlay",
    ".cct-modal-overlay",
    ".st-modal-overlay",
    ".auto-rule-modal-overlay",
  ]) {
    assert.match(contract, new RegExp(selector.replace(".", "\\.")));
  }

  assert.match(contract, /place-items:\s*center\s*!important/);
  assert.match(contract, /padding-left:\s*max\(16px, env\(safe-area-inset-left, 0px\)\)\s*!important/);
  assert.match(contract, /height:\s*auto\s*!important/);
  assert.match(contract, /border-radius:\s*var\(--modal-radius\)\s*!important/);
});

test("small-screen modals fill the available screen width", async () => {
  const source = await readFile(path.join(root, "app/globals.css"), "utf8");
  const contract = source.slice(source.indexOf("MODAL VIEWPORT CONTRACT"));

  assert.match(contract, /@media\s*\(max-width:\s*820px\)/);
  assert.match(contract, /body\s+:is\([\s\S]*?\.modal-container[\s\S]*?\.auto-rule-modal[\s\S]*?\)\[class\]\s*\{[\s\S]*?width:\s*calc\(100vw - 10px\)\s*!important[\s\S]*?max-width:\s*calc\(100vw - 10px\)\s*!important/);
  assert.match(contract, /@media\s*\(max-width:\s*820px\)[\s\S]*?padding-right:\s*5px\s*!important[\s\S]*?padding-left:\s*5px\s*!important/);
  assert.match(contract, /padding-bottom:\s*max\(16px, env\(safe-area-inset-bottom, 0px\)\)\s*!important/);
  assert.match(contract, /\.tx-month-popover\s*\{[^}]*width:\s*calc\(100vw - 10px\)/s);
});
