import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import TestExclude from "test-exclude";

const directory = process.env.NODE_V8_COVERAGE;
if (directory) {
  // Keep the exact JavaScript executed by tsx. Source-map line lengths alone cannot
  // enumerate statements and branches inside functions that tests never call.
  const config = JSON.parse(readFileSync(path.resolve(".c8rc.json"), "utf8"));
  const scope = new TestExclude({ cwd: process.cwd(), include: config.include, exclude: config.exclude, extension: config.extension });
  mkdirSync(directory, { recursive: true });
  const compile = Module.prototype._compile;
  Module.prototype._compile = function collectCompiledSource(source, filename) {
    if (scope.shouldInstrument(filename.split("?tsx-commonjs-", 1)[0])) {
      const url = pathToFileURL(filename).href;
      const id = createHash("sha256").update(url).update(source).digest("hex");
      writeFileSync(path.join(directory, `source-${id}.json`), JSON.stringify({ url, source }));
    }
    return compile.call(this, source, filename);
  };
  // Native ESM and any ESM transformations use Node's load hook instead.
  await import("monocart-coverage-reports/register");
}
