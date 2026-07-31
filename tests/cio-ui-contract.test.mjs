import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("CIO is reachable through the authenticated workspace shell and navigation", async () => {
  const [route, workspaceRoute, dispatcher, sidebar, shell] = await Promise.all([
    source("app/cio/page.tsx"),
    source("app/w/[workspaceId]/cio/page.tsx"),
    source("app/w/[workspaceId]/[[...path]]/page.tsx"),
    source("components/app-sidebar.tsx"),
    source("components/app-shell.tsx"),
  ]);

  assert.match(route, /<PageFrame[\s\S]*current="\/cio"/);
  assert.match(route, /<CioPage \/>/);
  assert.match(workspaceRoute, /export \{ default \} from "@\/app\/cio\/page"/);
  assert.doesNotMatch(dispatcher, /@\/app\/cio\/page|case "cio"/);
  assert.match(sidebar, /workspaceHref\("\/cio"\)[\s\S]*Nest CIO/);
  assert.match(shell, /workspaceHref\("\/cio"\)[\s\S]*Portfolio health and long-term planning/);
});

test("CIO overview remains deterministic and Ask CIO opens Ask Nest with page context", async () => {
  const [overview, hook] = await Promise.all([
    source("components/cio/cio-overview.tsx"),
    source("hooks/use-cio-overview.ts"),
  ]);

  assert.match(overview, /aria-controls=["']ask-nest-panel/);
  assert.match(overview, /\.click\(\)/);
  assert.doesNotMatch(overview, /\/api\/ai\/ask|fetch\(/);
  assert.match(hook, /queryKeys\.cioOverview\(workspaceId\)/);
  assert.match(hook, /\/api\/cio\/overview/);
  assert.match(hook, /\/api\/cio\/policy/);
});

test("CIO decision readiness is compact by default with accessible expandable detail", async () => {
  const [health, styles] = await Promise.all([
    source("components/cio/cio-health-summary.tsx"),
    source("app/styles/cio.css"),
  ]);

  assert.match(health, /<details className=\{`cio-health-card is-\$\{statusTone\}`\}>/);
  assert.match(health, /<summary className="cio-health-summary-row">/);
  assert.doesNotMatch(health, /<details[^>]*\sopen(?:=|>)/);
  assert.match(health, /cio-health-issue-count/);
  assert.match(health, /role="progressbar"/);
  assert.match(styles, /\.cio-health-summary-row:focus-visible/);
  assert.match(styles, /\.cio-health-card\[open\] \.cio-health-chevron/);
});

test("CIO configuration covers every bounded API family", async () => {
  const files = await Promise.all([
    source("components/cio/dialogs/cio-profile-dialog.tsx"),
    source("components/cio/dialogs/cio-policy-dialog.tsx"),
    source("components/cio/dialogs/cio-positions-dialog.tsx"),
    source("components/cio/dialogs/cio-flows-dialog.tsx"),
    source("components/cio/dialogs/cio-investment-profile-dialog.tsx"),
    source("components/cio/cio-retirement-card.tsx"),
  ]);
  const combined = files.join("\n");

  for (const endpoint of [
    "/api/cio/profile",
    "/api/cio/policy",
    "/api/cio/planning-positions",
    "/api/cio/recurring-flows",
    "/api/cio/investments/",
    "/api/cio/retirement-projection",
  ]) assert.match(combined, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.match(files[4], /profile: CioInvestmentProfile/);
  assert.match(files[4], /exposures: CioExposure\[\]/);
  assert.match(files[2], /items: CioPlanningPosition\[\]/);
  assert.match(files[3], /items: CioRecurringFlow\[\]/);
  assert.match(files[5], /response\.projection\.retirement\.status !== "READY"/);
  assert.match(files[5], /return response\.projection\.retirement\.projection/);
});

test("CIO strategy reports can be generated, previewed, archived, and downloaded", async () => {
  const [overview, reportCard, queryKeys] = await Promise.all([
    source("components/cio/cio-overview.tsx"),
    source("components/cio/cio-strategy-reports-card.tsx"),
    source("lib/query-keys.ts"),
  ]);

  assert.match(overview, /<CioStrategyReportsCard canEdit=\{canEdit\}/);
  assert.match(reportCard, /apiFetch<[^>]+>\("\/api\/cio\/reports"/);
  assert.match(reportCard, /method: "POST"/);
  assert.match(reportCard, /workspaceFetch\(`\/api\/cio\/reports\/\$\{encodeURIComponent\(report\.id\)\}\/pdf`/);
  assert.match(reportCard, /latest\.topRecommendations\.map/);
  assert.match(reportCard, /Previous reports/);
  assert.match(queryKeys, /cioReports: \(workspaceId\?/);
});

test("CIO charts provide readable equivalents and responsive accessible styling", async () => {
  const [allocation, retirement, globals, styles, utilities] = await Promise.all([
    source("components/cio/charts/allocation-chart.tsx"),
    source("components/cio/charts/retirement-projection-chart.tsx"),
    source("app/globals.css"),
    source("app/styles/cio.css"),
    source("app/styles/utilities.css"),
  ]);

  assert.match(allocation, /role="img"/);
  assert.match(allocation, /<table className="cio-data-table">/);
  assert.match(retirement, /<title id=/);
  assert.match(retirement, /<desc id=/);
  assert.match(retirement, /<table className="cio-data-table">/);
  assert.match(retirement, /useState<CioRetirementScenarioName>\("BASE"\)/);
  assert.match(retirement, /aria-label="Yearly projection scenario"/);
  assert.match(retirement, /setTableScenarioName\(scenario\.scenario\)/);
  assert.match(retirement, /formatCioPercent\(scenario\.nominalReturnBps\)/);
  assert.match(retirement, /tableScenario\.points\.map/);
  assert.match(retirement, /<caption>/);
  assert.match(retirement, /x\(point\.date\)/);
  assert.match(retirement, /point\.date/);
  assert.match(globals, /@import "\.\/styles\/cio\.css"/);
  assert.match(styles, /@container cio \(max-width: 720px\)/);
  assert.match(utilities, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /stroke-dasharray/);
  assert.match(styles, /summary:focus-visible/);
});

test("focused CIO components stay below the 400-line controller ceiling", async () => {
  const roots = ["components/cio", "components/cio/dialogs", "components/cio/charts"];
  const files = new Set(["components/cio-page.tsx"]);
  for (const directory of roots) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".tsx")) files.add(path.join(directory, entry.name));
    }
  }
  for (const file of files) {
    const lines = (await source(file)).split(/\r?\n/).length;
    assert.ok(lines <= 400, `${file} has ${lines} lines`);
  }
});
