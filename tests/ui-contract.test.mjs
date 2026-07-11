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
