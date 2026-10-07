import assert from "node:assert/strict";
import test from "node:test";
import { collectAnalysisFindings, collectDuplicationFindings, qualityGateSummary } from "../scripts/sonar-report.mjs";

test("quality evidence preserves recognized measurements without copying arbitrary server content", () => {
  const summary = qualityGateSummary({
    status: "ERROR", ignoredConditions: true, unexpected: "untrusted payload",
    conditions: [
      { metricKey: "coverage", status: "ERROR", actualValue: "18.12", errorThreshold: "80", comparator: "GT", unknown: "untrusted payload" },
      { metricKey: "violations", status: "OK", actualValue: "0" },
      { metricKey: "untrusted payload", status: "OK", actualValue: "1" },
    ],
  });
  assert.equal(summary.status, "ERROR");
  assert.equal(summary.ignoredConditions, true);
  assert.deepEqual(summary.conditions.find((condition) => condition.metricKey === "coverage"), {
    metricKey: "coverage", status: "ERROR", actualValue: 18.12, errorThreshold: 100, comparator: "LT",
  });
  assert.equal(summary.conditions.length, 2);
  assert.doesNotMatch(JSON.stringify(summary), /untrusted payload/);
});

test("missing, invalid, and unknown report fields cannot masquerade as a passing result", () => {
  assert.deepEqual(qualityGateSummary(), { status: "UNKNOWN", ignoredConditions: false, conditions: [] });
  assert.equal(qualityGateSummary({ status: "unexpected", conditions: {} }).status, "UNKNOWN");
  for (const actualValue of [undefined, null, "", "not a number", "Infinity"]) {
    const summary = qualityGateSummary({ status: "OK", conditions: [null, { metricKey: "coverage", status: "invalid", actualValue }] });
    assert.equal(summary.conditions[0].actualValue, null);
    assert.equal(summary.conditions[0].status, "UNKNOWN");
  }
});

test("finding artifacts retain locations across every page and omit account metadata and excerpts", async () => {
  const calls = [];
  const issue = { key: "issue", rule: "typescript:S3776", component: "nest:lib/example.ts", line: 5, textRange: { startLine: 5, endLine: 5, startOffset: 0, endOffset: 8 }, message: "Simplify this function", severity: "CRITICAL", type: "CODE_SMELL", author: "private-author", assignee: "private-assignee", source: "private-source" };
  const hotspot = { key: "hotspot", component: "nest:lib/example.ts", line: 8, message: "Review this use", status: "TO_REVIEW", vulnerabilityProbability: "HIGH", securityCategory: "dos", author: "private-author" };
  const api = async (endpoint, parameters) => {
    calls.push({ endpoint, parameters });
    if (endpoint === "api/hotspots/search") return { paging: { total: 1 }, hotspots: [hotspot] };
    return { total: 501, issues: parameters.p === 1 ? Array.from({ length: 500 }, (_, index) => ({ ...issue, key: `issue-${index}` })) : [{ ...issue, key: "issue-500" }] };
  };
  const report = await collectAnalysisFindings(api, "nest");
  assert.equal(report.issues.length, 501);
  assert.equal(report.issues.at(-1).key, "issue-500");
  assert.deepEqual(report.issues[0].textRange, issue.textRange);
  assert.equal(report.hotspots[0].status, "TO_REVIEW");
  assert.doesNotMatch(JSON.stringify(report), /private-/);
  assert.deepEqual(calls.filter((call) => call.endpoint === "api/issues/search").map((call) => call.parameters), [
    { componentKeys: "nest", resolved: "false", ps: 500, p: 1 },
    { componentKeys: "nest", resolved: "false", ps: 500, p: 2 },
  ]);
});

test("empty findings remain explicit and malformed or failed collection cannot look like an empty report", async () => {
  const empty = { total: 0, issues: [], hotspots: [] };
  assert.deepEqual(await collectAnalysisFindings(async () => empty, "nest"), { issues: [], hotspots: [] });
  for (const invalid of [{}, { total: -1, issues: [] }, { total: 1, issues: null }, { total: "0", issues: [] }, { total: 1, issues: [] }]) {
    await assert.rejects(collectAnalysisFindings(async (endpoint) => endpoint === "api/issues/search" ? invalid : empty, "nest"), /Invalid|Incomplete/);
  }
  await assert.rejects(collectAnalysisFindings(async () => { throw new Error("Connection failed"); }, "nest"), /Connection failed/);
});

test("duplication diagnostics traverse all file measures and keep only the locations needed for refactoring", async () => {
  const calls = [];
  const api = async (endpoint, parameters) => {
    calls.push({ endpoint, parameters });
    if (endpoint === "api/measures/component_tree") {
      return { paging: { total: 501 }, components: parameters.p === 1
        ? Array.from({ length: 500 }, (_, i) => ({ key: `nest:lib/clean-${i}.ts`, measures: [{ metric: "duplicated_blocks", value: "0" }] }))
        : [{ key: "nest:lib/repeated.ts", measures: [{ metric: "duplicated_blocks", value: "1" }] }] };
    }
    return {
      duplications: [{ blocks: [{ _ref: "1", from: 12, size: 15 }, { _ref: "2", from: 23, size: 15 }], source: "private-source" }],
      files: { "1": { key: "nest:lib/repeated.ts", author: "private-author" }, "2": { key: "nest:lib/other.ts", projectName: "private-project-name" } },
    };
  };
  const result = await collectDuplicationFindings(api, "nest");
  assert.deepEqual(result, [{ component: "nest:lib/repeated.ts", groups: [[
    { component: "nest:lib/repeated.ts", startLine: 12, lineCount: 15 },
    { component: "nest:lib/other.ts", startLine: 23, lineCount: 15 },
  ]] }]);
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].parameters, { component: "nest", metricKeys: "duplicated_blocks", qualifiers: "FIL", strategy: "leaves", ps: 500, p: 2 });
  assert.deepEqual(calls[2], { endpoint: "api/duplications/show", parameters: { key: "nest:lib/repeated.ts" } });
});

test("missing duplication metadata fails explicitly and files with zero duplication need no detail requests", async () => {
  assert.deepEqual(await collectDuplicationFindings(async () => ({ total: 3, components: [
    { key: "nest:a" }, { key: "nest:b", measures: [{ metric: "lines", value: "10" }] },
    { key: "nest:c", measures: [{ metric: "duplicated_blocks", value: "0" }] },
  ] }), "nest"), []);
  const duplicated = { total: 1, components: [{ key: "nest:source", measures: [{ metric: "duplicated_blocks", value: "1" }] }] };
  const valid = { duplications: [{ blocks: [{ _ref: "1", from: 1, size: 10 }] }], files: { "1": { key: "nest:source" } } };
  const invalid = [
    {}, { duplications: [], files: null }, { duplications: [], files: "invalid" }, { ...valid, duplications: [{ blocks: null }] },
    ...[
      { _ref: "missing", from: 1, size: 1 }, { _ref: "1", from: 0, size: 1 },
      { _ref: "1", from: "1", size: 1 }, { _ref: "1", from: 1, size: 0 }, { _ref: "1", from: 1, size: "1" },
    ].map((block) => ({ ...valid, duplications: [{ blocks: [block] }] })),
  ];
  for (const response of invalid) {
    await assert.rejects(collectDuplicationFindings(async (endpoint) => endpoint === "api/measures/component_tree" ? duplicated : response, "nest"), /Invalid duplication/);
  }
});
