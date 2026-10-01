import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function checkSarif(report) {
  if (report.version !== "2.1.0" || !Array.isArray(report.runs) || report.runs.length === 0) {
    throw new Error("CodeQL did not produce a valid SARIF report.");
  }
  let findings = 0;
  for (const run of report.runs) {
    if (!Array.isArray(run.results)) throw new Error("CodeQL results are missing.");
    if (run.invocations?.some((invocation) => invocation.executionSuccessful === false || invocation.toolExecutionNotifications?.some((notification) => notification.level === "error"))) {
      throw new Error("CodeQL reported an incomplete or failed analysis.");
    }
    // Every result blocks, including low-severity and suppressed results.
    findings += run.results.length;
  }
  return findings;
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Pass the CodeQL SARIF output directory.");
  const files = (await readdir(directory, { recursive: true })).filter((file) => file.endsWith(".sarif"));
  if (!files.length) throw new Error("CodeQL produced no SARIF files; refusing to pass.");
  let findings = 0;
  for (const file of files) findings += checkSarif(JSON.parse(await readFile(path.join(directory, file), "utf8")));
  if (findings) throw new Error(`CodeQL reported ${findings} findings. The strict quality gate allows zero.`);
  console.log(`CodeQL passed: ${files.length} reports, zero findings.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
