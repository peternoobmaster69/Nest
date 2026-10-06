import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const nextRoot = path.join(root, ".next");
const budgetPath = path.join(root, "docs", "ui-performance-budget.json");
const writeBaseline = process.argv.includes("--write-baseline");
const check = process.argv.includes("--check");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }))).flat();
}

function parseManifest(source) {
  const match = source.match(/__RSC_MANIFEST\["([^"]+)"\]\s*=\s*(\{.*\});\s*$/s);
  return match ? { route: match[1], manifest: JSON.parse(match[2]) } : null;
}

async function fileMetrics(files) {
  let bytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const normalized = file.replace(/^\/_next\//, "");
    const target = path.join(nextRoot, normalized);
    if (!existsSync(target)) continue;
    const data = await readFile(target);
    bytes += data.byteLength;
    gzipBytes += gzipSync(data).byteLength;
  }
  return { bytes, gzipBytes, files: files.length };
}

if (!existsSync(nextRoot)) throw new Error("Run `npm run build` before measuring UI bundles.");
const manifests = (await walk(path.join(nextRoot, "server", "app")))
  .filter((file) => file.endsWith("_client-reference-manifest.js"));
const report = {};

for (const file of manifests) {
  const parsed = parseManifest(await readFile(file, "utf8"));
  if (!parsed || parsed.route.includes("/api/")) continue;
  const initialJs = new Set(Object.values(parsed.manifest.entryJSFiles ?? {}).flat());
  const initialCss = new Set(Object.values(parsed.manifest.entryCSSFiles ?? {}).flat().map((entry) => entry.path));
  const asyncJs = new Set();
  for (const clientModule of Object.values(parsed.manifest.clientModules ?? {})) {
    if (clientModule.async) for (const chunk of clientModule.chunks ?? []) asyncJs.add(chunk);
  }
  report[parsed.route] = {
    javascript: await fileMetrics([...initialJs]),
    css: await fileMetrics([...initialCss]),
    lazyJavascript: await fileMetrics([...asyncJs]),
  };
}

const result = { generatedAt: new Date().toISOString(), allowedRegressionPercent: 5, routes: report };

if (writeBaseline) {
  await writeFile(budgetPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${path.relative(root, budgetPath)} for ${Object.keys(report).length} routes.`);
} else if (check) {
  if (!existsSync(budgetPath)) throw new Error("UI performance baseline is missing. Run `npm run ui:metrics:baseline` after a production build.");
  const baseline = JSON.parse(await readFile(budgetPath, "utf8"));
  const failures = [];
  for (const [route, metrics] of Object.entries(report)) {
    const expected = baseline.routes?.[route];
    if (!expected) continue;
    for (const asset of ["javascript", "css"]) {
      const maximum = Math.ceil(expected[asset].gzipBytes * 1.05);
      if (metrics[asset].gzipBytes > maximum) failures.push(`${route} ${asset}: ${metrics[asset].gzipBytes} > ${maximum} gzip bytes`);
    }
  }
  if (failures.length) throw new Error(`UI performance budget exceeded:\n${failures.join("\n")}`);
  console.log(`UI performance budgets passed for ${Object.keys(report).length} routes.`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
