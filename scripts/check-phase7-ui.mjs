import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { countSourceLines } from "./source-lines.mjs";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const child = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  }))).flat();
}

const globals = await read("app/globals.css");
const globalLines = countSourceLines(globals);
assert.ok(globalLines <= Math.floor(23_795 * 0.6), `globals.css must stay at least 40% below its Phase 7 baseline; found ${globalLines} lines`);
for (const layer of ["tokens", "base", "features", "components", "utilities"]) {
  assert.match(globals, new RegExp(`@import ["']\\./styles/${layer}\\.css["']`));
}

const componentFiles = (await walk("components")).filter((file) => file.endsWith(".tsx"));
const featureFiles = componentFiles.filter((file) => !file.startsWith("components/ui/"));
for (const file of featureFiles) {
  const source = await read(file);
  assert.doesNotMatch(source, /<(?:button|input|select|textarea)\b/, `${file} bypasses shared action/form primitives`);
  assert.doesNotMatch(source, /<div[^>]+(?:modal|popover|signin)-overlay/, `${file} bypasses Dialog`);
  assert.doesNotMatch(source, /queryKey:\s*\[/, `${file} bypasses the typed query-key factory`);
}

assert.equal(existsSync(path.join(root, "components/modal-viewport-manager.tsx")), false, "legacy mutation-observer modal manager must stay removed");
const providers = await read("app/providers.tsx");
assert.doesNotMatch(providers, /ModalViewportManager/);
assert.match(await read("app/layout.tsx"), /from "next\/font\/google"/);

const exceptions = JSON.parse(await read("docs/ui-component-exceptions.json"));
for (const file of componentFiles) {
  const lines = countSourceLines(await read(file));
  if (lines <= 400) continue;
  const exception = exceptions[file];
  assert.ok(exception, `${file} exceeds 400 lines without a documented exception`);
  assert.ok(lines <= exception.maxLines, `${file} grew beyond its documented ${exception.maxLines}-line ceiling`);
}

const styles = (await Promise.all((await walk("app/styles")).filter((file) => file.endsWith(".css")).map(read))).join("\n");
const importantCount = (styles.match(/!important/g) ?? []).length;
assert.ok(importantCount <= 382, `!important usage regressed above the Phase 7 reduced baseline: ${importantCount}`);
const stylesOutsideTokens = await Promise.all(["base", "features", "components", "utilities"]
  .map((name) => path.join(root, "app", "styles", `${name}.css`))
  .map((file) => readFile(file, "utf8")));
const nonTokenStyles = stylesOutsideTokens.join("\n");
assert.ok((nonTokenStyles.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length <= 209, "raw color usage outside tokens increased");
assert.ok((nonTokenStyles.match(/z-index:\s*(?!var\()[0-9-]+/g) ?? []).length <= 48, "raw z-index usage outside tokens increased");
assert.ok((styles.match(/@media/g) ?? []).length <= 111, "breakpoint fragmentation increased");
const tokens = await read("app/styles/tokens.css");
for (const token of ["--space-1", "--text-base", "--color-primary", "--shadow-md", "--focus-ring-color", "--duration-base", "--touch-target-min"]) {
  assert.match(tokens, new RegExp(token));
}

console.log("Phase 7 UI architecture contract passed.");
