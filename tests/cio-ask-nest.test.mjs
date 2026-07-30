import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildAskNestPlanningHint, classifyAskNestIntent } from "../lib/ai/ask-nest-intent.mjs";
import {
  CIO_ASK_NEST_TOOL_NAMES,
  executeCioAskNestTool,
  getCioAskNestTools,
} from "../lib/ai/tools/cio-tools.ts";
import {
  ensureCioDataDate,
  findUnsupportedCioValue,
} from "../lib/ai/cio-grounding.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("CIO Ask Nest registry exposes only bounded read-only tools without workspace overrides", () => {
  const tools = getCioAskNestTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...CIO_ASK_NEST_TOOL_NAMES]);

  for (const tool of tools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.type, "object");
    assert.equal(tool.parameters.additionalProperties, false);
    assert.doesNotMatch(JSON.stringify(tool.parameters), /workspace_?id/i);
    assert.match(tool.description, /read-only|Nothing is saved|never places orders/i);
  }
});

test("CIO tools are domain-decomposed and registered behind the stable Ask Nest registry", async () => {
  const [cioTools, stableRegistry] = await Promise.all([
    source("lib/ai/tools/cio-tools.ts"),
    source("lib/ai/ask-nest-tools.ts"),
  ]);

  assert.match(stableRegistry, /getCioAskNestTools/);
  assert.match(stableRegistry, /executeCioAskNestTool/);
  assert.match(cioTools, /buildCioSnapshot/);
  assert.match(cioTools, /runWorkspaceRetirementProjection/);
  assert.match(cioTools, /workspaceId: context\.workspaceId/);
  assert.doesNotMatch(cioTools, /prisma\./);
  assert.doesNotMatch(cioTools, /\.(?:create|update|upsert|delete|deleteMany|createMany)\s*\(/);
  assert.doesNotMatch(cioTools, /massive-market-data|serpapi-news|searchSerpApiNews|getMassiveDailyMarketHistory/);
});

test("CIO tool outputs retain dates, assumptions, completeness warnings, unknowns, and evidence", async () => {
  const cioTools = await source("lib/ai/tools/cio-tools.ts");

  assert.match(cioTools, /asOfDate: snapshot\.asOfDate/);
  assert.match(cioTools, /contributionAssumption/);
  assert.match(cioTools, /warningCount: summary\.warnings\.length/);
  assert.match(cioTools, /warningsTruncated/);
  assert.match(cioTools, /unknownAssetClass/);
  assert.match(cioTools, /unknownGeography/);
  assert.match(cioTools, /unknownSecurity/);
  assert.match(cioTools, /securityBucketCount/);
  assert.match(cioTools, /omittedSecurityAllocation/);
  assert.match(cioTools, /evidence: toEvidence/);
  assert.match(cioTools, /internalReallocationsExcluded/);
  assert.match(cioTools, /sampledPoints/);
  assert.match(cioTools, /totalPointCount/);
  assert.match(cioTools, /callId\.slice\(0, 120\).*cio-evidence/);
  assert.match(cioTools, /domain: "CIO"/);
  assert.match(cioTools, /evidence: result\.evidence/);
});

test("CIO tools reject impossible calendar dates before workspace data access", async () => {
  await assert.rejects(
    executeCioAskNestTool(
      "get_cio_overview",
      { as_of_date: "2026-02-30" },
      { workspaceId: "workspace-test", userId: "user-test", currency: "SGD", callId: "call-test" },
    ),
    /valid calendar date/,
  );
});

test("CIO domain failures are converted to a bounded model-safe unavailable result", async () => {
  const cioTools = await source("lib/ai/tools/cio-tools.ts");

  assert.match(cioTools, /error instanceof ApiRequestError/);
  assert.match(cioTools, /code: "CIO_REQUEST_UNAVAILABLE"/);
  assert.match(cioTools, /Nest could not safely evaluate this CIO request/);
  assert.doesNotMatch(cioTools, /error\.(?:message|stack)/);
});

test("CIO answer grounding rejects unsupported dates and percentages and supplies the data date", () => {
  const outputs = [{
    ok: true,
    domain: "CIO",
    asOfDate: "2026-07-30",
    allocation: { formatted: "42.50%" },
    gap: { formatted: "-SGD 1,000.00" },
  }];

  assert.equal(findUnsupportedCioValue({
    answer: "The recorded allocation is 42.5% as of 2026-07-30.",
    highlights: [],
  }, outputs), null);
  assert.equal(findUnsupportedCioValue({
    answer: "The recorded allocation is 43% as of 2026-07-30.",
    highlights: [],
  }, outputs), "43%");
  assert.equal(findUnsupportedCioValue({
    answer: "The data is current as of 2026-07-29.",
    highlights: [],
  }, outputs), "2026-07-29");
  assert.equal(findUnsupportedCioValue({
    answer: "The gap is SGD -1,000.00 as of 2026-07-30.",
    highlights: [],
  }, outputs), null);
  assert.equal(findUnsupportedCioValue({
    answer: "The surplus is SGD 1,000.00 as of 2026-07-30.",
    highlights: [],
  }, outputs), "SGD 1,000.00");

  const dated = ensureCioDataDate("The allocation is recorded in Nest.", outputs);
  assert.equal(dated, "The allocation is recorded in Nest. Data date: 2026-07-30.");
  assert.equal(ensureCioDataDate(dated, outputs), dated);
  assert.ok(ensureCioDataDate("x ".repeat(1_000), outputs).length <= 1_600);
});

test("CIO intent hints route representative planning questions deterministically", () => {
  const cases = [
    ["What is my true asset allocation?", "get_cio_overview"],
    ["How much is liquid for an emergency?", "get_cio_overview"],
    ["Can I retire at 60?", "run_cio_retirement_projection"],
    ["What if I add SGD 10,000 each year?", "compare_cio_contribution_scenarios"],
    ["Am I outside my investment policy?", "get_cio_policy_status"],
    ["Which CIO data is stale or unclassified?", "get_cio_overview"],
    ["How much do I contribute each year?", "get_cio_overview"],
    ["What are my recurring contributions?", "get_cio_overview"],
    ["How much do I withdraw annually?", "get_cio_overview"],
    ["How much is liquid for an emergency?", "get_cio_overview"],
    ["Should I divest Income+?", "get_cio_policy_status"],
  ];

  for (const [question, expectedTool] of cases) {
    const intent = classifyAskNestIntent(question, "/cio");
    assert.ok(intent.recommendedTools.includes(expectedTool), `${question} should route to ${expectedTool}`);
  }

  assert.ok(
    !classifyAskNestIntent("How much do I contribute each year?", "/cio")
      .recommendedTools.includes("compare_cio_contribution_scenarios"),
  );
});

test("CIO projection terminology questions route as no-tool conceptual answers", () => {
  const questions = [
    "What is today's money and nominal?",
    "What do today's money and nominal mean?",
    "Explain nominal versus real values.",
    "What are real terms compared with nominal terms?",
    "Nominal and today's-money values: what is the difference?",
    "What does nominal mean?",
    "What is today's money?",
    "What is the definition of real values?",
  ];

  for (const question of questions) {
    const intent = classifyAskNestIntent(question, "/cio");
    assert.equal(intent.intent, "cio_projection_terms", question);
    assert.deepEqual(intent.recommendedTools, [], question);
    assert.equal(intent.needsHybridRetrieval, false, question);
    assert.equal(intent.confidence, "HIGH", question);
  }

  const hint = buildAskNestPlanningHint(questions[0], "/cio");
  assert.match(hint, /No read tool is recommended/);
  assert.match(hint, /without workspace data, dates, percentages, or illustrative currency amounts/);
  assert.doesNotMatch(hint, /get_cio_overview/);
  assert.doesNotMatch(hint, /Recommended first tool/);

  const personalized = classifyAskNestIntent("Show my retirement projection in nominal and real terms", "/cio");
  assert.ok(personalized.recommendedTools.includes("run_cio_retirement_projection"));

  const outsideCio = classifyAskNestIntent("What does nominal mean?", "/");
  assert.notEqual(outsideCio.intent, "cio_projection_terms");
});
