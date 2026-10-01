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
  findUnsupportedCurrencyValue,
  isReferentialFinancialFollowUp,
  userSuppliedCurrencyGrounding,
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
  assert.match(cioTools, /buildWorkspaceCioStrategyRecommendations/);
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
  assert.doesNotMatch(cioTools, /rank: index \+ 1/);
  assert.doesNotMatch(cioTools, /priority: item\.priority/);
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
  const bounded = ensureCioDataDate("x ".repeat(4_000), outputs);
  assert.ok(bounded.length <= 6_000);
  assert.ok(bounded.endsWith("Data date: 2026-07-30."));
});

test("CIO grounding accepts equivalent money formatting and user-labelled scenario inputs", () => {
  const outputs = [{
    ok: true,
    domain: "CIO",
    asOfDate: "2026-07-31",
    amount: { formatted: "SGD 10,000.00" },
    allocation: { formatted: "42.50%" },
  }];
  const scenarioContext = ["Could we model SGD 12,000 at 55% by 2035-01-01?"];

  assert.equal(findUnsupportedCurrencyValue({
    answer: "The recorded amount is SGD 10000.",
    highlights: [],
  }, [JSON.stringify(outputs)]), null);
  assert.equal(findUnsupportedCurrencyValue({
    answer: "The projected amount is approximately SGD 2,742.",
    highlights: [],
  }, [JSON.stringify({ amount: { formatted: "SGD 2,741.51" } })]), null);
  assert.equal(findUnsupportedCurrencyValue({
    answer: "The projected amount is SGD 2,743.",
    highlights: [],
  }, [JSON.stringify({ amount: { formatted: "SGD 2,741.51" } })]), "SGD 2,743");
  assert.equal(findUnsupportedCioValue({
    answer: "Your proposed scenario is SGD 12,000 at 55% by 2035-01-01.",
    highlights: [],
  }, outputs, scenarioContext), null);
  assert.equal(findUnsupportedCioValue({
    answer: "The calculated scenario is SGD 13,000 at 56% by 2036-01-01.",
    highlights: [],
  }, outputs, scenarioContext), "SGD 13,000");
});

test("CIO grounding accepts cited public financial research and preserves user-proposed amounts", () => {
  const outputs = [{
    ok: true,
    domain: "PUBLIC_FINANCIAL_RESEARCH",
    fetchedAt: "2026-07-31T10:00:00.000Z",
    sources: [{
      snippet: "Average monthly household expenditure was SGD 5,931 and rose 2.8%.",
      normalizedFinancialValues: ["SGD 5,931"],
    }],
  }];
  const userContext = ["Is SGD 8,000 a month too much or too little?"];

  assert.equal(findUnsupportedCioValue({
    answer: "Your proposed SGD 8,000 is above the cited SGD 5,931 benchmark, which the source says rose 2.8%.",
    highlights: [],
  }, outputs, userContext), null);
  assert.equal(findUnsupportedCioValue({
    answer: "A more suitable benchmark is SGD 6,000.",
    highlights: [],
  }, outputs, userContext), "SGD 6,000");
  assert.equal(findUnsupportedCioValue({
    answer: "The source says the benchmark rose 3.1%.",
    highlights: [],
  }, outputs, userContext), "3.1%");
  assert.equal(findUnsupportedCioValue({
    answer: "This was reported in the 2024 survey.",
    highlights: [],
  }, outputs, userContext), "2024");
});

test("referential follow-ups may reuse the immediately preceding grounded financial value", () => {
  const outputs = [{ ok: true, domain: "PUBLIC_FINANCIAL_RESEARCH", sources: [{ title: "Public benchmark" }] }];
  assert.equal(isReferentialFinancialFollowUp("Compare this against Singapore public retirement spending benchmarks."), true);
  assert.equal(isReferentialFinancialFollowUp("Show spending this month."), false);
  assert.deepEqual(
    userSuppliedCurrencyGrounding(["Is 8000 a month too much or too little?"], "SGD"),
    ["SGD 8000"],
  );
  assert.equal(findUnsupportedCioValue({
    answer: "The comparison uses the previous proposed amount of SGD 8,000.",
    highlights: [],
  }, outputs, ["The previous grounded answer used SGD 8,000."]), null);
});

test("CIO answers may add qualitative judgment without inventing numerical targets", async () => {
  const orchestration = await source("lib/ai/ask-nest.ts");

  assert.match(orchestration, /qualitative CIO judgment explaining their sequence and trade-offs/);
  assert.match(orchestration, /proposed assumptions or scenario inputs/);
  assert.match(orchestration, /never invent a numerical target, contribution amount, or security-specific action/);
});

test("CIO intent hints route representative planning questions deterministically", () => {
  const cases = [
    ["What is my true asset allocation?", "get_cio_overview"],
    ["How much is liquid for an emergency?", "get_cio_overview"],
    ["Can I retire at 60?", "run_cio_retirement_projection"],
    ["How much do I and my wife need in today's money when I retire in 2052?", "run_cio_retirement_projection"],
    ["What if I add SGD 10,000 each year?", "compare_cio_contribution_scenarios"],
    ["Am I outside my investment policy?", "get_cio_policy_status"],
    ["Which CIO data is stale or unclassified?", "get_cio_overview"],
    ["How much do I contribute each year?", "get_cio_overview"],
    ["What are my recurring contributions?", "get_cio_overview"],
    ["How much do I withdraw annually?", "get_cio_overview"],
    ["How much is liquid for an emergency?", "get_cio_overview"],
    ["Should I divest Income+?", "get_cio_policy_status"],
    ["What household investment strategy do you recommend?", "get_cio_strategy_recommendations"],
    ["Is 8000 a month too much or too little?", "search_public_financial_sources"],
  ];

  for (const [question, expectedTool] of cases) {
    const intent = classifyAskNestIntent(question, "/cio");
    assert.ok(intent.recommendedTools.includes(expectedTool), `${question} should route to ${expectedTool}`);
  }

  assert.ok(
    !classifyAskNestIntent("How much do I contribute each year?", "/cio")
      .recommendedTools.includes("compare_cio_contribution_scenarios"),
  );
  assert.deepEqual(
    classifyAskNestIntent("Is 8000 a month too much or too little?", "/cio").recommendedTools,
    ["run_cio_retirement_projection", "search_public_financial_sources"],
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
