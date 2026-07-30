import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

function arrowFunctionContaining(sourceText, needle) {
  const needleIndex = sourceText.indexOf(needle);
  assert.notEqual(needleIndex, -1, `Missing ${needle}`);

  const candidates = [...sourceText.slice(0, needleIndex).matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*\{/g)];
  const candidate = candidates.at(-1);
  assert.ok(candidate, `${needle} must be inside a named arrow-function handler`);

  const openingBrace = candidate.index + candidate[0].lastIndexOf("{");
  let depth = 0;
  for (let index = openingBrace; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) {
      const body = sourceText.slice(openingBrace + 1, index);
      assert.ok(body.includes(needle), `${needle} must remain inside ${candidate[1]}`);
      return { name: candidate[1], body };
    }
  }

  assert.fail(`${candidate[1]} has an unterminated function body`);
}

function defaultBinding(sourceText, overviewPath) {
  const escapedPath = overviewPath.replaceAll(".", "\\.");
  const match = new RegExp(
    `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*moneyInputFromCents\\(\\s*${escapedPath}\\s*\\)`,
  ).exec(sourceText);
  return match?.[1] ?? null;
}

function resetCallIndex(handlerBody, setter, overviewPath, binding) {
  const escapedPath = overviewPath.replaceAll(".", "\\.");
  const inline = new RegExp(
    `${setter}\\(\\s*moneyInputFromCents\\(\\s*${escapedPath}\\s*\\)\\s*\\)`,
  ).exec(handlerBody);
  if (inline) return inline.index;
  if (!binding) return -1;
  return new RegExp(`${setter}\\(\\s*${binding}\\s*\\)`).exec(handlerBody)?.index ?? -1;
}

test("temporary retirement scenario results are gated by the open scenario panel", async () => {
  const card = await source("components/cio/cio-retirement-card.tsx");
  const projection = /const\s+projection\s*=\s*([^;]+);/.exec(card);
  assert.ok(projection, "The retirement card must derive a projection for display");

  const expression = projection[1].replaceAll(/\s+/g, " ");
  const gatesDirectly = /scenarioOpen\s*\?\s*\(?\s*mutation\.data/.test(expression)
    || /scenarioOpen\s*&&\s*mutation\.data/.test(expression);
  const scenarioProjectionBinding = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*scenarioOpen\s*\?\s*mutation\.data\s*:/.exec(card);
  const gatesThroughBinding = scenarioProjectionBinding
    ? new RegExp(`\\b${scenarioProjectionBinding[1]}\\b`).test(expression)
    : false;

  assert.ok(
    gatesDirectly || gatesThroughBinding,
    "mutation.data must only replace the persisted projection while scenarioOpen is true",
  );
});

test("closing a retirement scenario resets transient results and restores default inputs", async () => {
  const card = await source("components/cio/cio-retirement-card.tsx");
  const handler = arrowFunctionContaining(card, "setScenarioOpen(false)");
  const closeIndex = handler.body.indexOf("setScenarioOpen(false)");
  const mutationResetIndex = handler.body.indexOf("mutation.reset()");

  const assetsPath = "overview.totals.retirementIncludedAssetsCents";
  const contributionPath = "overview.annualContributions.usedExternalAnnualCents";
  const assetsResetIndex = resetCallIndex(handler.body, "setAssets", assetsPath, defaultBinding(card, assetsPath));
  const contributionResetIndex = resetCallIndex(
    handler.body,
    "setAnnualContribution",
    contributionPath,
    defaultBinding(card, contributionPath),
  );

  assert.ok(mutationResetIndex >= 0, `${handler.name} must call mutation.reset()`);
  assert.ok(assetsResetIndex >= 0, `${handler.name} must restore retirement assets from the overview default`);
  assert.ok(contributionResetIndex >= 0, `${handler.name} must restore annual contribution from the overview default`);
  assert.ok(mutationResetIndex < closeIndex, "mutation state must reset before the scenario panel closes");
  assert.ok(assetsResetIndex < closeIndex, "retirement assets must reset before the scenario panel closes");
  assert.ok(contributionResetIndex < closeIndex, "annual contribution must reset before the scenario panel closes");

  assert.match(
    card,
    new RegExp(`onClick\\s*=\\s*\\{(?:\\s*${handler.name}\\s*|\\s*\\(\\s*\\)\\s*=>\\s*${handler.name}\\(\\s*\\)\\s*)\\}`),
    `${handler.name} must be connected to the scenario toggle button`,
  );
});
