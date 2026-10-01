import { randomBytes } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { createClient, policy } from "./sonar-policy.mjs";

async function main() {
  // Default credentials are permitted only for the empty, loopback-only CI container.
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || process.env.SONAR_DISPOSABLE !== "true" || process.env.SONAR_HOST_URL !== "http://127.0.0.1:9000" || !process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) {
    throw new Error("Bootstrap is restricted to the disposable SonarQube container on a GitHub-hosted runner.");
  }
  const basicClient = (password) => {
    const credentials = Buffer.from(`admin:${password}`).toString("base64");
    return createClient({ authorization: `Basic ${credentials}` });
  };
  const initial = basicClient("admin");
  const deadline = Date.now() + 300_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      ready = (await initial("api/system/status")).status === "UP";
      if (ready) break;
    } catch {
      // The container's web process is not yet accepting connections.
    }
    await setTimeout(2_000);
  }
  if (!ready) throw new Error("Disposable SonarQube did not start within five minutes.");
  const projects = await initial("api/projects/search", { ps: "1" });
  if (projects.paging.total !== 0) throw new Error("Refusing to bootstrap an existing SonarQube instance.");
  const password = `Nest_${randomBytes(32).toString("hex")}Aa1!`;
  console.log(`::add-mask::${password}`);
  await initial("api/users/change_password", { login: "admin", previousPassword: "admin", password }, "POST");
  const admin = basicClient(password);
  await admin("api/projects/create", { project: policy.projectKey, name: policy.projectName, visibility: "private" }, "POST");
  const expirationDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const [name, type] of [["SONAR_ADMIN_TOKEN", "USER_TOKEN"], ["SONAR_TOKEN", "PROJECT_ANALYSIS_TOKEN"]]) {
    const params = { name: `nest-ci-${type}`, type, expirationDate };
    if (type === "PROJECT_ANALYSIS_TOKEN") params.projectKey = policy.projectKey;
    const { token } = await admin("api/user_tokens/generate", params, "POST");
    if (!token) throw new Error("SonarQube did not return a CI token.");
    console.log(`::add-mask::${token}`);
    const filename = path.join(process.env.RUNNER_TEMP, `${name.toLowerCase()}.txt`);
    await writeFile(filename, `${token}\n`, { mode: 0o600, flag: "wx" });
    await appendFile(process.env.GITHUB_ENV, `${name}_FILE=${filename}\n`);
  }
  console.log("Disposable SonarQube is ready; CI credentials expire tomorrow.");
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
