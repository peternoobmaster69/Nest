import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

function blockAfter(sourceText, headerPattern, label) {
  const match = headerPattern.exec(sourceText);
  assert.ok(match, `${label} is missing`);
  const openingBrace = sourceText.indexOf("{", match.index);
  assert.notEqual(openingBrace, -1, `${label} has no declaration block`);

  let depth = 0;
  for (let index = openingBrace; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) return sourceText.slice(openingBrace + 1, index);
  }

  assert.fail(`${label} has an unterminated declaration block`);
}

function declarationsFor(cssBlock, selector) {
  const withoutComments = cssBlock.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const declarations = [];
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of withoutComments.matchAll(rules)) {
    const selectors = match[1].split(",").map((value) => value.trim());
    if (selectors.includes(selector)) declarations.push(match[2]);
  }
  return declarations.join("\n");
}

function assertColumns(cssBlock, selector, expected, breakpoint) {
  const declarations = declarationsFor(cssBlock, selector);
  assert.ok(declarations, `${selector} is missing from the ${breakpoint} CIO dialog container rule`);
  assert.match(
    declarations.replaceAll(/\s+/g, " "),
    expected,
    `${selector} does not collapse at ${breakpoint}`,
  );
}

test("every CIO dialog opts into the modal-local responsive container", async () => {
  const directory = path.join(root, "components/cio/dialogs");
  const entries = await readdir(directory, { withFileTypes: true });
  const dialogFiles = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    const contents = await readFile(path.join(directory, entry.name), "utf8");
    const dialogCount = contents.match(/<Dialog\b/g)?.length ?? 0;
    if (!dialogCount) continue;
    dialogFiles.push(entry.name);

    const responsiveClassCount = contents.match(/\bcontentClassName\s*=\s*["']cio-dialog["']/g)?.length ?? 0;
    assert.equal(
      responsiveClassCount,
      dialogCount,
      `${entry.name} must pass contentClassName="cio-dialog" to every Dialog`,
    );
  }

  assert.ok(dialogFiles.length > 0, "No CIO Dialog components were found");

  const styles = await source("app/styles/cio.css");
  const containerRule = blockAfter(styles, /\.cio-dialog\s*\{/, ".cio-dialog container rule");
  const usesShorthand = /\bcontainer\s*:\s*cio-dialog\s*\/\s*inline-size\s*;/.test(containerRule);
  const usesLonghand = /\bcontainer-name\s*:\s*cio-dialog\s*;/.test(containerRule)
    && /\bcontainer-type\s*:\s*inline-size\s*;/.test(containerRule);
  assert.ok(usesShorthand || usesLonghand, ".cio-dialog must define the named cio-dialog inline-size container");
});

test("CIO dialog container queries collapse dense grids at mobile widths", async () => {
  const styles = await source("app/styles/cio.css");
  const at720 = blockAfter(
    styles,
    /@container\s+cio-dialog\s*\(\s*max-width\s*:\s*720px\s*\)/,
    "720px cio-dialog container query",
  );
  const at480 = blockAfter(
    styles,
    /@container\s+cio-dialog\s*\(\s*max-width\s*:\s*480px\s*\)/,
    "480px cio-dialog container query",
  );

  const oneColumn = /grid-template-columns:\s*(?:1fr|minmax\(\s*0\s*,\s*1fr\s*\))\s*;/;
  const reducedColumns = /grid-template-columns:\s*(?:1fr|1fr\s+1fr|repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\))\s*;/;

  assertColumns(at720, ".cio-setup-grid", oneColumn, "720px");
  for (const selector of [".cio-policy-band-row", ".cio-policy-geography-row", ".cio-exposure-row"]) {
    assertColumns(at720, selector, reducedColumns, "720px");
  }

  for (const selector of [".cio-check-grid", ".cio-policy-band-row", ".cio-policy-geography-row", ".cio-exposure-row"]) {
    assertColumns(at480, selector, oneColumn, "480px");
  }
});
