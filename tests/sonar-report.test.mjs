import assert from "node:assert/strict";
import test from "node:test";
import { qualityGateSummary } from "../scripts/sonar-report.mjs";

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
