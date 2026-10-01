import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const policy = JSON.parse(await readFile(new URL("../quality/sonar-policy.json", import.meta.url), "utf8"));

export async function readToken(name, env = process.env) {
  const token = env[name]?.trim() || (env[`${name}_FILE`] && (await readFile(env[`${name}_FILE`], "utf8")).trim());
  if (!token || /\s/.test(token)) throw new Error(`Set ${name} or ${name}_FILE to a valid token. Do not commit credentials.`);
  return token;
}

export function createClient({ serverUrl = process.env.SONAR_HOST_URL || "http://localhost:9000", token, authorization, fetchImpl = fetch }) {
  const base = new URL(serverUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(loopback && base.protocol === "http:"))) {
    throw new Error("Use an HTTPS SonarQube URL, or HTTP on localhost, without embedded credentials or query parameters.");
  }
  const api = async (endpoint, params = {}, method = "GET") => {
    if (!endpoint.startsWith("api/")) throw new Error("Expected a relative SonarQube API endpoint.");
    const url = new URL(`${base.href.replace(/\/$/, "")}/${endpoint}`);
    const form = new URLSearchParams(params);
    if (method === "GET") url.search = form.toString();
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: authorization || `Bearer ${token}` },
      body: method === "POST" ? form : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Do not echo server response bodies: authentication endpoints may contain secrets.
      const error = new Error(`SonarQube ${endpoint} returned HTTP ${response.status}. ${response.status === 403 ? "Check the token's project and administration permissions." : ""}`);
      error.status = response.status;
      throw error;
    }
    const body = await response.text();
    if (!body && (method === "POST" || response.status === 204)) return {};
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`SonarQube ${endpoint} did not return valid JSON.`);
    }
  };
  api.serverUrl = base.href.replace(/\/$/, "");
  return api;
}

const conditionKey = ({ metric, op, error }) => `${metric}:${op}:${Number(error)}`;

export function gateDrift(actual, expected = policy.conditions) {
  const present = new Set(actual.map(conditionKey));
  const required = new Set(expected.map(conditionKey));
  return [
    ...expected.filter((condition) => !present.has(conditionKey(condition))).map((condition) => `Missing condition ${conditionKey(condition)}`),
    ...actual.filter((condition) => !required.has(conditionKey(condition))).map((condition) => `Unexpected condition ${conditionKey(condition)}`),
  ];
}

function baseProfile(profiles, language) {
  for (const name of policy.baseProfiles) {
    const profile = profiles.find((entry) => entry.language === language && entry.name === name && entry.isBuiltIn);
    if (profile) return profile;
  }
  throw new Error(`No comprehensive built-in quality profile is installed for ${language}.`);
}

const ruleFilter = (language, filter) => ({ languages: language, statuses: "READY", is_template: "false", ...filter });

async function configureProfile(api, profiles, language) {
  const parent = baseProfile(profiles, language);
  let profile = profiles.find((entry) => entry.language === language && entry.name === policy.profileName);
  if (!profile) {
    ({ profile } = await api("api/qualityprofiles/create", { language, name: policy.profileName }, "POST"));
  }
  await api("api/qualityprofiles/change_parent", { language, qualityProfile: policy.profileName, parentQualityProfile: parent.name }, "POST");
  for (const filter of policy.additionalRuleFilters) {
    const result = await api("api/qualityprofiles/activate_rules", { targetKey: profile.key, ...ruleFilter(language, filter) }, "POST");
    if (result.failed > 0) throw new Error(`Could not activate ${result.failed} rules for ${language}.`);
  }
  for (const rule of policy.explicitRules[language] || []) {
    await api("api/qualityprofiles/activate_rule", { key: profile.key, rule }, "POST");
  }
  await api("api/qualityprofiles/add_project", { language, qualityProfile: policy.profileName, project: policy.projectKey }, "POST");
  console.log(`${language}: ${policy.profileName} inherits ${parent.name} with additional security and reliability checks.`);
}

export async function configurePolicy(api) {
  const gates = await api("api/qualitygates/list");
  if (!gates.actions?.create) throw new Error("An administrator user token is required to configure Nest's quality gate and profiles.");
  const projects = await api("api/projects/search", { projects: policy.projectKey });
  if (!projects.components.some((project) => project.key === policy.projectKey)) {
    await api("api/projects/create", { project: policy.projectKey, name: policy.projectName, visibility: "private" }, "POST");
  }
  if (!gates.qualitygates.some((gate) => gate.name === policy.gateName)) {
    await api("api/qualitygates/create", { name: policy.gateName }, "POST");
  }
  const gate = await api("api/qualitygates/show", { name: policy.gateName });
  const wanted = new Set(policy.conditions.map(conditionKey));
  for (const condition of gate.conditions) {
    if (!wanted.has(conditionKey(condition))) await api("api/qualitygates/delete_condition", { id: condition.id }, "POST");
  }
  const present = new Set(gate.conditions.map(conditionKey));
  for (const condition of policy.conditions) {
    if (!present.has(conditionKey(condition))) await api("api/qualitygates/create_condition", { gateName: policy.gateName, ...condition }, "POST");
  }
  for (const [key, value] of Object.entries(policy.settings)) {
    await api("api/settings/set", { component: policy.projectKey, key, value }, "POST");
  }
  await api("api/new_code_periods/set", { project: policy.projectKey, type: "NUMBER_OF_DAYS", value: "30" }, "POST");

  const { profiles } = await api("api/qualityprofiles/search");
  for (const language of policy.languages) {
    await configureProfile(api, profiles, language);
  }
  // Associate only after configuration succeeds. Never change the server's default gate or profiles.
  await api("api/qualitygates/select", { gateName: policy.gateName, projectKey: policy.projectKey }, "POST");
}

async function profileDrift(api, profiles, profile, language) {
  const parent = baseProfile(profiles, language);
  if (profile?.name !== policy.profileName || profile.parentKey !== parent.key) {
    return [`${language} must use ${policy.profileName}, inheriting ${parent.name}.`];
  }
  const errors = [];
  const comparison = await api("api/qualityprofiles/compare", { leftKey: parent.key, rightKey: profile.key });
  if (comparison.inLeft?.length || comparison.modified?.length) errors.push(`${language} has missing or modified comprehensive rules.`);
  for (const filter of policy.additionalRuleFilters) {
    const missing = await api("api/rules/search", { qprofile: profile.key, activation: "false", ps: "1", ...ruleFilter(language, filter) });
    if (missing.total > 0) errors.push(`${language} is missing ${missing.total} required security or reliability rules.`);
  }
  for (const rule of policy.explicitRules[language] || []) {
    const active = await api("api/rules/search", { qprofile: profile.key, rule_key: rule, activation: "true", ps: "1" });
    if (active.total !== 1) errors.push(`Required rule ${rule} is inactive.`);
  }
  return errors;
}

export async function verifyPolicy(api) {
  const errors = [];
  const { qualityGate } = await api("api/qualitygates/get_by_project", { project: policy.projectKey });
  if (qualityGate.name !== policy.gateName) errors.push(`Assigned gate is ${qualityGate.name}; expected ${policy.gateName}.`);
  const gate = await api("api/qualitygates/show", { name: policy.gateName });
  errors.push(...gateDrift(gate.conditions));
  const { settings } = await api("api/settings/values", { component: policy.projectKey, keys: Object.keys(policy.settings).join(",") });
  for (const [key, value] of Object.entries(policy.settings)) {
    if (settings.find((setting) => setting.key === key)?.value !== value) errors.push(`${key} must be ${value}.`);
  }
  const { profiles } = await api("api/qualityprofiles/search");
  const { profiles: assigned } = await api("api/qualityprofiles/search", { project: policy.projectKey });
  for (const language of policy.languages) {
    errors.push(...await profileDrift(api, profiles, assigned.find((entry) => entry.language === language), language));
  }
  return errors;
}

export async function coverageSources(directory = root) {
  const directories = ["app", "components", "hooks", "lib", "public", "scripts", "prisma", "types"];
  const files = [];
  for (const source of directories) {
    const entries = await readdir(path.join(directory, source), { recursive: true });
    files.push(...entries.map((entry) => `${source}/${entry.split(path.sep).join("/")}`));
  }
  return [...files, "proxy.ts", "instrumentation.ts", "next.config.ts"].filter((file) => /\.(?:[cm]?js|tsx?)$/.test(file) && !file.endsWith(".d.ts") && !file.startsWith("prisma/migrations/"));
}

export function checkLcov(text, sources, directory = root) {
  if (!/^DA:\d+,\d+/m.test(text) || !/^end_of_record$/m.test(text)) throw new Error("LCOV is empty or invalid; run npm run test:coverage.");
  const included = new Set([...text.matchAll(/^SF:(.+)$/gm)].map((match) => path.relative(directory, path.resolve(directory, match[1].trim())).split(path.sep).join("/")));
  const missing = sources.filter((source) => !included.has(source));
  if (missing.length) throw new Error(`LCOV omits ${missing.length} source files, including ${missing.slice(0, 5).join(", ")}. Unloaded production files must count as uncovered.`);
}

export async function verifyCoverage() {
  const report = path.join(root, "coverage/lcov.info");
  const sources = await coverageSources();
  const text = await readFile(report, "utf8").catch(() => { throw new Error("Coverage is missing; run npm run test:coverage first."); });
  checkLcov(text, sources);
  const reportStat = await stat(report);
  const sourceStats = await Promise.all(sources.map((source) => stat(path.join(root, source))));
  if (sourceStats.some((source) => source.mtimeMs > reportStat.mtimeMs)) throw new Error("Coverage predates source changes; rerun npm run test:coverage.");
}

export function coverageFailures(summary) {
  return ["lines", "statements", "functions", "branches"].filter((metric) => {
    const value = summary.total?.[metric];
    return !value || !Number.isFinite(value.total) || value.total < 0 || (value.total === 0 && ["lines", "statements"].includes(metric)) || value.covered !== value.total || value.skipped !== 0;
  }).map((metric) => `${metric} coverage must be exactly 100%, with no skipped entries.`);
}

export function analysisFailures(task, status) {
  const errors = [];
  if (task.status !== "SUCCESS" || !task.analysisId) errors.push("SonarQube analysis did not complete successfully.");
  if (status.status !== "OK") errors.push(`SonarQube quality gate is ${status.status || "missing"}.`);
  if (!Array.isArray(status.conditions) || status.conditions.length === 0) errors.push("SonarQube returned no evaluated gate conditions.");
  if (status.ignoredConditions) errors.push("SonarQube ignored one or more quality gate conditions.");
  for (const condition of status.conditions || []) {
    if (condition.status !== "OK") errors.push(`${condition.metricKey}: ${condition.actualValue ?? "missing"}; required ${condition.comparator} ${condition.errorThreshold} (failure boundary).`);
  }
  return errors;
}
