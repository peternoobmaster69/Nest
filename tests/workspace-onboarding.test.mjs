import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  countCompletedWorkspaceSetupSteps,
  getRequiredWorkspaceSetupStep,
  getWorkspaceSetupStep,
} from "../lib/workspace-setup.ts";
import { readAppStyles } from "./read-app-styles.mjs";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("new workspace setup progresses through required bank and sub-account before optional card", () => {
  const empty = { bankAccountCount: 0, subAccountCount: 0, creditCardCount: 0 };
  assert.equal(getWorkspaceSetupStep(empty, "unseen"), "welcome");
  assert.equal(getWorkspaceSetupStep(empty, "started"), "bank");
  assert.equal(getRequiredWorkspaceSetupStep(empty), "bank");

  const bankOnly = { ...empty, bankAccountCount: 1 };
  assert.equal(getWorkspaceSetupStep(bankOnly, "started"), "subaccount");
  assert.equal(getRequiredWorkspaceSetupStep(bankOnly), "subaccount");

  const coreComplete = { ...bankOnly, subAccountCount: 1 };
  assert.equal(getWorkspaceSetupStep(coreComplete, "started"), "card");
  assert.equal(getWorkspaceSetupStep(coreComplete, "complete"), "complete");
  assert.equal(getWorkspaceSetupStep(coreComplete, "unseen"), "complete", "existing configured workspaces are not nagged");
  assert.equal(countCompletedWorkspaceSetupSteps(coreComplete), 2);

  const allComplete = { ...coreComplete, creditCardCount: 1 };
  assert.equal(getWorkspaceSetupStep(allComplete, "started"), "complete");
  assert.equal(countCompletedWorkspaceSetupSteps(allComplete), 3);
});

test("required setup returns if a completed workspace loses its bank or sub-account", () => {
  assert.equal(getWorkspaceSetupStep({ bankAccountCount: 0, subAccountCount: 1, creditCardCount: 0 }, "complete"), "bank");
  assert.equal(getWorkspaceSetupStep({ bankAccountCount: 1, subAccountCount: 0, creditCardCount: 0 }, "complete"), "subaccount");
});

test("workspace context exposes one setup snapshot without a separate onboarding endpoint", async () => {
  const context = await source("app/api/context/route.ts");
  assert.match(context, /setupProgress:\s*\{[\s\S]*?bankAccountCount:[\s\S]*?subAccountCount:[\s\S]*?creditCardCount:/);
  assert.match(context, /workspace\.financials\.filter\(\(account\) => account\.kind === "BANK"\)/);
  assert.match(context, /selectedMembership\?\.workspace\._count\.budgetEnvelopes/);
  assert.match(context, /selectedMembership\?\.workspace\._count\.creditCards/);
});

test("the shared shell offers onboarding only to workspace editors and lazy-loads the workflow", async () => {
  const [shell, boundary] = await Promise.all([
    source("components/app-shell.tsx"),
    source("components/onboarding/workspace-setup-guide-boundary.tsx"),
  ]);
  assert.match(shell, /<WorkspaceSetupGuideBoundary workspaceId=\{navigationWorkspaceId\} context=\{contextData\}/);
  assert.match(boundary, /dynamic\([\s\S]*?workspace-setup-guide/);
  assert.match(boundary, /context\?\.role === "OWNER" \|\| context\?\.role === "EDITOR"/);
  assert.match(boundary, /context\.setupProgress/);
});

test("the guide persists progress per workspace while keeping required setup resumable", async () => {
  const guide = await source("components/onboarding/workspace-setup-guide.tsx");
  assert.match(guide, /nest:workspace-setup:\$\{SETUP_VERSION\}:\$\{workspaceId\}/);
  assert.match(guide, /window\.localStorage\.setItem\(preferenceKey, "started"\)/);
  assert.match(guide, /window\.sessionStorage\.setItem\(snoozeKey, "1"\)/);
  assert.match(guide, />Skip for now</);
  assert.match(guide, /window\.localStorage\.setItem\(preferenceKey, "complete"\)/);
  assert.match(guide, /\/api\/accounts[\s\S]*?\/api\/budgets[\s\S]*?\/api\/credit-cards/);
});

test("setup mutations refresh their cards and workspace context", async () => {
  const guide = await source("components/onboarding/workspace-setup-guide.tsx");
  assert.match(guide, /invalidateQueries\(\{ queryKey: queryKeys\.context\(workspaceId\) \}\)/);
  assert.match(guide, /refreshWorkspace\("bank-accounts", "budgets", "dashboard-summary"\)/);
  assert.match(guide, /refreshWorkspace\("budgets", "dashboard-summary"\)/);
  assert.match(guide, /refreshWorkspace\("credit-cards", "dashboard-summary"\)/);
});

test("onboarding uses the mobile dialog and anti-overlap form contract", async () => {
  const [guide, styles] = await Promise.all([
    source("components/onboarding/workspace-setup-guide.tsx"),
    readAppStyles(root),
  ]);
  assert.match(guide, /<Dialog[\s\S]*?size="md"[\s\S]*?contentClassName="setup-guide-modal"/);
  assert.doesNotMatch(guide, /surface="custom"/);
  assert.doesNotMatch(guide, /<(?:button|input|select|textarea)\b/);
  assert.match(styles, /\.setup-guide-form-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media \(max-width: 820px\), \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.setup-guide-form-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.setup-guide-form-grid > \*,[\s\S]*?min-inline-size:\s*0/);
  assert.match(styles, /\.setup-guide-modal \.modal-footer \.btn\s*\{[^}]*flex:\s*1 1 0/);
  assert.match(styles, /\.setup-guide-launcher\s*\{[^}]*inset-block-end:\s*calc\(var\(--touch-target-min\) \+ var\(--space-6\)\)/s);
  assert.match(styles, /\.setup-guide-launcher[\s\S]*?inset-block-end:\s*calc\(var\(--mobile-nav-height\) \+ var\(--space-3\)\)/);
});
