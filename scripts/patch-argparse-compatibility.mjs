import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// argparse 2 removes the vulnerable sprintf-js dependency. Its legacy version
// option accidentally passes an uninitialized field instead of the given value.
// Keep Remarkable's existing CLI working while it still uses that legacy option.
export async function patchArgparseCompatibility(filename) {
  const source = await readFile(filename, "utf8");
  const original = "version: this.version,";
  const replacement = "version,";
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest === "8f9f2f1bd6134aa9bc85a575b937936fe874383cf2fd32e67a9ee35d33c32b90") return false;
  if (digest !== "2e73e7a3167ba840dbcf41feeafc3544a3e2b39220b5e997133c519861febf16") {
    throw new Error("argparse changed; review and update its compatibility patch before installing.");
  }
  await writeFile(filename, source.replace(original, replacement));
  return true;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const remarkableRequire = createRequire(require.resolve("remarkable/package.json"));
  await patchArgparseCompatibility(remarkableRequire.resolve("argparse"));
}
