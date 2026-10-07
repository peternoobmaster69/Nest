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

async function readFindingPages(api, endpoint, parameters, field) {
  const findings = [];
  for (let page = 1; ; page += 1) {
    const result = await api(endpoint, { ...parameters, ps: 500, p: page });
    const total = result.paging?.total ?? result.total;
    const rows = result[field];
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(rows)) {
      throw new Error(`Invalid ${field} response from SonarQube.`);
    }
    findings.push(...rows);
    if (findings.length >= total) return findings;
    if (!rows.length) throw new Error(`Incomplete ${field} response from SonarQube.`);
  }
}

/** Keep diagnostic locations and messages, without account metadata or source excerpts. */
export async function collectAnalysisFindings(api, projectKey) {
  const [issues, hotspots] = await Promise.all([
    readFindingPages(api, "api/issues/search", { componentKeys: projectKey, resolved: "false" }, "issues"),
    readFindingPages(api, "api/hotspots/search", { projectKey }, "hotspots"),
  ]);
  return {
    issues: issues.map(({ key, rule, component, line, textRange, message, severity, type }) => ({
      key, rule, component, line, textRange, message, severity, type,
    })),
    hotspots: hotspots.map(({ key, component, line, message, status, vulnerabilityProbability, securityCategory }) => ({
      key, component, line, message, status, vulnerabilityProbability, securityCategory,
    })),
  };
}

function duplicationBlocks(blocks, files) {
  if (!Array.isArray(blocks)) throw new Error("Invalid duplication blocks from SonarQube.");
  return blocks.map(({ _ref, from, size }) => {
    const component = files[_ref]?.key;
    if (typeof component !== "string" || !Number.isSafeInteger(from) || from < 1 || !Number.isSafeInteger(size) || size < 1) {
      throw new Error("Invalid duplication location from SonarQube.");
    }
    return { component, startLine: from, lineCount: size };
  });
}

/** Retain cross-file duplication locations so an isolated CI server is not needed for diagnosis. */
export async function collectDuplicationFindings(api, projectKey) {
  const components = await readFindingPages(api, "api/measures/component_tree", {
    component: projectKey, metricKeys: "duplicated_blocks", qualifiers: "FIL", strategy: "leaves",
  }, "components");
  const duplicated = components.filter((component) => component.measures?.some((measure) => measure.metric === "duplicated_blocks" && Number(measure.value) > 0));
  return Promise.all(duplicated.map(async ({ key }) => {
    const result = await api("api/duplications/show", { key });
    if (!Array.isArray(result.duplications) || !result.files || typeof result.files !== "object") {
      throw new Error("Invalid duplication response from SonarQube.");
    }
    return { component: key, groups: result.duplications.map(({ blocks }) => duplicationBlocks(blocks, result.files)) };
  }));
}
