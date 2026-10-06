import { policy } from "./sonar-policy.mjs";

const STATUS_VALUES = ["OK", "ERROR", "WARN", "NONE"];

function numericMetric(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Store only known metric names, enumerated statuses, and numeric measurements. */
export function qualityGateSummary(status) {
  const conditions = Array.isArray(status?.conditions) ? status.conditions : [];
  return {
    status: STATUS_VALUES.find((value) => value === status?.status) || "UNKNOWN",
    ignoredConditions: status?.ignoredConditions === true,
    conditions: policy.conditions.flatMap((expected) => {
      const condition = conditions.find((entry) => entry?.metricKey === expected.metric);
      if (!condition) return [];
      return [{
        metricKey: expected.metric,
        status: STATUS_VALUES.find((value) => value === condition.status) || "UNKNOWN",
        comparator: expected.op,
        errorThreshold: Number(expected.error),
        actualValue: numericMetric(condition.actualValue),
      }];
    }),
  };
}
