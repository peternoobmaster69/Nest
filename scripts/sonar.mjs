import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { scan } from "@sonar/scan";
import { analysisFailures, configurePolicy, coverageFailures, createClient, policy, readToken, root, verifyCoverage, verifyPolicy } from "./sonar-policy.mjs";

async function runScan(api, token, verifier) {
  await verifyCoverage();
  const errors = [];
  const report = { project: policy.projectKey, policyVersion: policy.version, scannedAt: new Date().toISOString() };
  const taskFile = path.join(root, ".scannerwork/report-task.txt");
  await rm(taskFile, { force: true });
  try {
    await scan({
      serverUrl: api.serverUrl,
      token,
      options: {
        "sonar.projectKey": policy.projectKey,
        "sonar.projectBaseDir": root,
        "sonar.javascript.node.executable": process.execPath,
        "sonar.qualitygate.wait": "true",
        "sonar.qualitygate.timeout": "600",
        "sonar.verbose": "false",
        "sonar.log.level": "INFO",
      },
    });
  } catch {
    errors.push("Scanner failed or its quality gate did not pass. See the scanner output above.");
  }
  try {
    const taskText = await readFile(taskFile, "utf8");
    const taskId = taskText.match(/^ceTaskId=(.+)$/m)?.[1]?.trim();
    if (!taskId) throw new Error("Scanner did not produce a compute-engine task ID.");
    const { task } = await api("api/ce/task", { id: taskId });
    report.taskId = taskId;
    report.analysisId = task.analysisId;
    const result = task.analysisId ? await api("api/qualitygates/project_status", { analysisId: task.analysisId }) : {};
    report.qualityGate = result.projectStatus;
    errors.push(...analysisFailures(task, result.projectStatus || {}));
    report.dashboard = `${api.serverUrl}/dashboard?id=${encodeURIComponent(policy.projectKey)}`;
  } catch (error) {
    errors.push(`Unable to verify this scan: ${error.message}`);
  }
  try {
    report.policyDrift = await verifyPolicy(verifier);
    errors.push(...report.policyDrift);
  } catch (error) {
    errors.push(`Policy verification failed: ${error.message}`);
  }
  const summary = JSON.parse(await readFile(path.join(root, "coverage/coverage-summary.json"), "utf8"));
  report.coverage = summary.total;
  errors.push(...coverageFailures(summary));
  report.errors = errors;
  report.passed = errors.length === 0;
  await mkdir(path.join(root, "coverage"), { recursive: true });
  await writeFile(path.join(root, "coverage/sonar-result.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`${policy.gateName} passed: ${report.dashboard}`);
}

async function main() {
  const command = process.argv[2];
  if (command === "coverage") {
    await verifyCoverage();
    const errors = coverageFailures(JSON.parse(await readFile(path.join(root, "coverage/coverage-summary.json"), "utf8")));
    if (errors.length) throw new Error(errors.join("\n"));
    return;
  }
  if (!["configure", "verify", "scan"].includes(command)) throw new Error("Usage: node scripts/sonar.mjs configure|verify|scan|coverage");
  const token = await readToken(command === "configure" ? "SONAR_ADMIN_TOKEN" : "SONAR_TOKEN");
  const api = createClient({ token });
  const verifier = process.env.SONAR_ADMIN_TOKEN || process.env.SONAR_ADMIN_TOKEN_FILE
    ? createClient({ token: await readToken("SONAR_ADMIN_TOKEN") })
    : api;
  if (command === "scan") return runScan(api, token, verifier);
  if (command === "configure") await configurePolicy(api);
  const errors = await verifyPolicy(verifier);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`${policy.gateName}: gate, rule profiles, and small-change enforcement verified.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
