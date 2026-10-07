import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decode, encode } from "@jridgewell/sourcemap-codec";
import { parse } from "acorn";
import { convert } from "ast-v8-to-istanbul";
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

async function readCompiledSources(collectedDirectory, filenames) {
  const sources = new Map();
  for (const filename of filenames.filter((name) => name.startsWith("source-") && name.endsWith(".json"))) {
    const data = JSON.parse(await readFile(path.join(collectedDirectory, filename), "utf8"));
    sources.set(`${data.processId}:${data.threadId}:${data.scriptId}`, data);
  }
  return sources;
}

async function hydrateEntries(data, filename, includesSource, sources) {
  const context = /^coverage-(\d+)-\d+-(\d+)\.json$/.exec(filename);
  const sourceMaps = new Map(Object.entries(data["source-map-cache"] ?? {})
    .map(([url, sourceMap]) => [canonicalFileURL(url), sourceMap]));
  const entries = data.result.filter((entry) => entry.url.startsWith("file:") && includesSource(entry.url));
  for (const entry of entries) {
    // V8 may leave route brackets literal while Node encodes its cache keys.
    entry.url = canonicalFileURL(entry.url);
    const sourceMap = sourceMaps.get(entry.url);
    const captured = sources.get(`${context?.[1]}:${context?.[2]}:${entry.scriptId}`);
    if (captured && canonicalFileURL(captured.url) === entry.url) {
      entry.source = captured.source;
    } else if (sourceMap?.data) {
      throw new Error(`Missing compiled coverage source: ${entry.url}`);
    } else {
      entry.source = await readFile(fileURLToPath(entry.url), "utf8");
    }
    if (sourceMap?.data) entry.sourceMap = sourceMap.data;
  }
  return entries;
}

async function addCollectedCoverage(report, collectedDirectory, includesSource) {
  const filenames = await readdir(collectedDirectory);
  const sources = await readCompiledSources(collectedDirectory, filenames);
  let hasCoverage = false;
  const tested = new Set();
  for (const filename of filenames.filter((name) => !name.startsWith("source-") && name.endsWith(".json"))) {
    const data = JSON.parse(await readFile(path.join(collectedDirectory, filename), "utf8"));
    if (!Array.isArray(data.result)) continue;
    hasCoverage ||= data.result.length > 0;
    const entries = await hydrateEntries(data, filename, includesSource, sources);
    for (const entry of entries) {
      for (const file of await addEntry(report, entry, includesSource)) tested.add(path.resolve(file));
    }
  }
  if (!hasCoverage) throw new Error("No V8 coverage was collected; run the test suite before reporting.");
  return tested;
}

function compilerHelpers(entry) {
  const wrapper = entry.source.indexOf("(()=>{");
  if (!entry.sourceMap || !entry.source.startsWith("__filename=") || wrapper < 0) return () => false;
  const exports = /module\.exports=__toCommonJS\([\w$]+\);/.exec(entry.source);
  if (!exports || !entry.source.slice(0, exports.index).includes("var __defProp=")) return () => false;
  const end = exports.index + exports[0].length;
  // tsx/esbuild's export getters and module wrapper do not exist in the source.
  // Ignore only those generated nodes, keeping every nested user-code node.
  return (node, type) => node.end <= end || (type === "function" && node.start === wrapper + 1);
}

async function addEntry(report, entry, includesSource) {
  terminateCommonJSAnnotationMap(entry);
  const result = await convert({
    code: entry.source,
    ast: parse(entry.source, { ecmaVersion: "latest", sourceType: "module", locations: true, ranges: true }),
    coverage: entry,
    sourceMap: entry.sourceMap,
    ignoreNode: compilerHelpers(entry),
  });
  const scoped = Object.fromEntries(Object.entries(result)
    .filter(([file]) => includesSource(file))
    .map(([file, coverage]) => {
      const relative = path.relative(process.cwd(), file);
      return [relative, { ...coverage, path: relative }];
    }));
  if (Object.keys(scoped).length) await report.add(scoped);
  return Object.keys(scoped);
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
});
report.cleanCache();
const tested = await addCollectedCoverage(report, collectedDirectory, includesSource);
// Enumerate every production source with zero hits, including unloaded function
// bodies and JSX. Istanbul merges these baselines with the actual V8 evidence.
for (const filename of selectedSources) {
  if (tested.has(filename)) continue;
  const entry = { url: pathToFileURL(filename).href, source: await readFile(filename, "utf8") };
  compileUntestedTypeScript(entry);
  entry.functions = [{ functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: entry.source.length, count: 0 }] }];
  await addEntry(report, entry, includesSource);
}
const results = await report.generate();
const expectedFiles = await scope.glob(cwd);
// Istanbul displays filenames relative to their shared parent directory.
// A focused report may share a deeper parent than the project root.
let reportBase = path.resolve(cwd, path.dirname(expectedFiles[0] ?? "."));
for (const filename of expectedFiles) {
  while (path.relative(reportBase, path.resolve(cwd, filename)).startsWith(`..${path.sep}`)) {
    reportBase = path.dirname(reportBase);
  }
}
const reportedFiles = new Set(results.files.map((file) => path.resolve(reportBase, file.sourcePath)));
const missingFiles = expectedFiles.filter((file) => !reportedFiles.has(path.resolve(cwd, file)));
if (missingFiles.length) throw new Error(`Coverage omitted production sources: ${missingFiles.join(", ")}`);
