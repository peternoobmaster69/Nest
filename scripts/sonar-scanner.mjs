import { spawn } from "node:child_process";

export async function runSonarScanner({ serverUrl, token, projectKey, root, executable = process.env.SONAR_SCANNER_PATH || "sonar-scanner" }) {
  const args = [
    `-Dsonar.projectKey=${projectKey}`,
    `-Dsonar.projectBaseDir=${root}`,
    `-Dsonar.javascript.node.executable=${process.execPath}`,
    "-Dsonar.qualitygate.wait=true",
    "-Dsonar.qualitygate.timeout=600",
    "-Dsonar.verbose=false",
    "-Dsonar.log.level=INFO",
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, SONAR_HOST_URL: serverUrl, SONAR_TOKEN: token },
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`SonarScanner exited with status ${code ?? "unknown"}.`));
    });
  });
}
