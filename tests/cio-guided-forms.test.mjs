import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("CIO setup presents a recommended order and separates optional inputs", async () => {
  const setup = await source("components/cio/dialogs/cio-setup-dialog.tsx");

  assert.match(setup, /Recommended setup/);
  assert.match(setup, /Current age is calculated for you/);
  assert.match(setup, /stage: "Start here"/);
  assert.match(setup, /stage: "Optional"/);
  assert.ok(setup.indexOf('id: "profile"') < setup.indexOf('id: "investments"'));
  assert.ok(setup.indexOf('id: "investments"') < setup.indexOf('id: "flows"'));
});

test("investment classification uses user language and hides storage metadata", async () => {
  const classification = await source("components/cio/dialogs/cio-investment-profile-dialog.tsx");

  assert.match(classification, /How quickly can you use the money\?/);
  assert.match(classification, /What job does it do in the portfolio\?/);
  assert.match(classification, /I have reviewed this account/);
  assert.match(classification, /classificationStatus: "USER_CONFIRMED"/);
  assert.match(classification, /classificationSource: "USER"/);
  assert.doesNotMatch(classification, /label="Classification status"|label="Classification source"/);
  assert.match(classification, /Breakdown unknown[\s\S]*allocation marked as unknown/);
});

test("planning positions explain scope and keep asset-only choices conditional", async () => {
  const positions = await source("components/cio/dialogs/cio-positions-dialog.tsx");

  assert.match(positions, /Do not re-enter a Nest bank or investment account/);
  assert.match(positions, /Asset - something you own/);
  assert.match(positions, /Liability - money you owe/);
  assert.match(positions, /form\.side === "ASSET" \? \(/);
  assert.match(positions, /Debts reduce CIO planning net worth/);
});

test("recurring flows reveal only references meaningful to the selected flow type", async () => {
  const flows = await source("components/cio/dialogs/cio-flows-dialog.tsx");

  assert.match(flows, /Contribution - new money coming in/);
  assert.match(flows, /Withdrawal - money leaving the plan/);
  assert.match(flows, /Internal reallocation - money moved within Nest/);
  assert.match(flows, /const showSources = form\.type !== "EXTERNAL_CONTRIBUTION"/);
  assert.match(flows, /const showDestination = form\.type !== "EXTERNAL_WITHDRAWAL"/);
  assert.match(flows, /It is tracked but never counted as new savings/);
});
