import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import { CoverageReport } from "monocart-coverage-reports";
import TestExclude from "test-exclude";
import ts from "typescript";

function compileUntestedTypeScript(entry) {
  if (!/\.tsx?$/.test(entry.url)) return;
  const transformed = ts.transpileModule(entry.source, {
    fileName: path.basename(entry.url),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      sourceMap: true,
      inlineSources: true,
    },
  });
  entry.source = transformed.outputText;
  entry.sourceMap = JSON.parse(transformed.sourceMapText);
  entry.sourceMap.sources = [entry.url];
}

function terminateCommonJSAnnotationMap(entry) {
  if (!entry.sourceMap) return;
  const annotation = /;0&&\(module\.exports=\{[\w,$:]*\}\);\s*\}\)\(\)/.exec(entry.source);
  if (!annotation) return;
  const start = annotation.index + 1;
  const prefix = entry.source.slice(0, start).split("\n");
  const line = prefix.length - 1;
  const column = prefix.at(-1).length;
  const mappings = decode(entry.sourceMap.mappings);
  const segments = mappings[line];
  if (!segments?.length || segments.at(-1)[0] >= column) return;
  // esbuild's CommonJS export annotation has no original source mapping. Mark
  // its boundary explicitly so the reporter cannot extend the preceding map
  // across this generated expression and attribute its dead branch to user code.
  segments.push([column]);
  entry.sourceMap.mappings = encode(mappings);
}

function canonicalFileURL(url) {
  return url.startsWith("file:") ? pathToFileURL(fileURLToPath(url)).href : url;
}

function compiledSource(entry, sourceMap, sources) {
  // A module can be native ESM in one test process and compiled CommonJS in
  // another. The URL alone cannot identify the JavaScript that V8 measured.
  const lengths = JSON.stringify(sourceMap.lineLengths);
  const candidates = sources.filter((source) => JSON.stringify(source.split("\n").map((line) => line.length)) === lengths);
  if (candidates.length !== 1) throw new Error(`Missing compiled coverage source or multiple matching versions: ${entry.url}`);
  return candidates[0];
}

async function addCollectedCoverage(report, collectedDirectory, includesSource) {
  const filenames = await readdir(collectedDirectory);
  const sources = new Map();
  for (const filename of filenames.filter((name) => name.startsWith("source-") && name.endsWith(".json"))) {
    const data = JSON.parse(await readFile(path.join(collectedDirectory, filename), "utf8"));
    const url = canonicalFileURL(data.url);
    const versions = sources.get(url) ?? new Set();
    versions.add(data.source);
    sources.set(url, versions);
  }
  let hasCoverage = false;
  for (const filename of filenames.filter((name) => !name.startsWith("source-") && name.endsWith(".json"))) {
    const data = JSON.parse(await readFile(path.join(collectedDirectory, filename), "utf8"));
    if (!Array.isArray(data.result)) continue;
    hasCoverage ||= data.result.length > 0;
    const sourceMaps = new Map(Object.entries(data["source-map-cache"] ?? {})
      .map(([url, sourceMap]) => [canonicalFileURL(url), sourceMap]));
    const entries = data.result.filter((entry) => entry.url.startsWith("file:") && includesSource(entry.url));
    for (const entry of entries) {
      // V8 may leave route brackets literal while Node encodes its cache keys.
      entry.url = canonicalFileURL(entry.url);
      const sourceMap = sourceMaps.get(entry.url);
      if (sourceMap?.data) {
        entry.source = compiledSource(entry, sourceMap, [...sources.get(entry.url) ?? []]);
        entry.sourceMap = sourceMap.data;
      } else {
        entry.source = await readFile(fileURLToPath(entry.url), "utf8");
      }
    }
    if (entries.length) await report.add(entries);
  }
  if (!hasCoverage) throw new Error("No V8 coverage was collected; run the test suite before reporting.");
}

const cwd = process.cwd();
const config = JSON.parse(await readFile(path.resolve(cwd, process.argv[2] ?? ".c8rc.json"), "utf8"));
if (config.all !== true) throw new Error("Coverage must include untested production sources.");
const scope = new TestExclude({
  cwd,
  include: config.include,
  exclude: config.exclude,
  extension: config.extension,
  relativePath: true,
  excludeNodeModules: true,
});
const selectedSources = new Set((await scope.glob(cwd)).map((file) => path.resolve(cwd, file)));
const includesSource = (value) => {
  const filename = value.startsWith("file:") ? fileURLToPath(value) : path.resolve(cwd, value);
  return selectedSources.has(filename.split("?tsx-commonjs-", 1)[0]);
};
const outputDir = path.resolve(cwd, config["reports-dir"]);
const collectedDirectory = path.join(outputDir, "tmp");
const report = new CoverageReport({
  baseDir: cwd,
  outputDir,
  clean: false,
  reports: config.reporter,
  onEntry: (entry) => {
    if (entry.fake) throw new Error(`Missing compiled coverage source: ${entry.url}`);
    terminateCommonJSAnnotationMap(entry);
  },
  entryFilter: (entry) => includesSource(entry.url),
  sourceFilter: includesSource,
  all: {
    dir: cwd,
    filter: (file) => includesSource(file) ? "js" : false,
    // Unloaded TS/TSX must be compiled too, so its functions and JSX remain in the denominator.
    transformer: compileUntestedTypeScript,
  },
});
report.cleanCache();
await addCollectedCoverage(report, collectedDirectory, includesSource);
const results = await report.generate();
const reportedFiles = new Set(results.files.map((file) => path.resolve(cwd, file.sourcePath)));
const expectedFiles = await scope.glob(cwd);
const missingFiles = expectedFiles.filter((file) => !reportedFiles.has(path.resolve(cwd, file)));
if (missingFiles.length) throw new Error(`Coverage omitted production sources: ${missingFiles.join(", ")}`);
