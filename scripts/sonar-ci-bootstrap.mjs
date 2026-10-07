import { randomBytes } from "node:crypto";
import { exportVariable, setSecret } from "@actions/core";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, policy } from "./sonar-policy.mjs";

export async function bootstrapSonar({
  env = process.env,
  client = createClient,
  mask = setSecret,
  publish = exportVariable,
  pause = setTimeout,
  now = Date.now,
} = {}) {
  // Default credentials are permitted only for the empty, loopback-only CI container.
  if (env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.SONAR_DISPOSABLE !== "true" || env.SONAR_HOST_URL !== "http://127.0.0.1:9000" || !env.RUNNER_TEMP || !env.GITHUB_ENV) {
    throw new Error("Bootstrap is restricted to the disposable SonarQube container on a GitHub-hosted runner.");
  }
  const basicClient = (password) => {
    const credentials = Buffer.from(`admin:${password}`).toString("base64");
    return client({ serverUrl: env.SONAR_HOST_URL, authorization: `Basic ${credentials}` });
  };
  const initial = basicClient("admin");
  const deadline = now() + 300_000;
  let ready = false;
  while (now() < deadline) {
    try {
      ready = (await initial("api/system/status")).status === "UP";
      if (ready) break;
    } catch {
      // The container's web process is not yet accepting connections.
    }
    await pause(2_000);
  }
  if (!ready) throw new Error("Disposable SonarQube did not start within five minutes.");
  const projects = await initial("api/projects/search", { ps: "1" });
  if (projects.paging.total !== 0) throw new Error("Refusing to bootstrap an existing SonarQube instance.");
  const password = `Nest_${randomBytes(32).toString("hex")}Aa1!`;
  mask(password);
  await initial("api/users/change_password", { login: "admin", previousPassword: "admin", password }, "POST");
  const admin = basicClient(password);
  await admin("api/projects/create", { project: policy.projectKey, name: policy.projectName, visibility: "private" }, "POST");
  // Sonar expires date-only tokens at midnight UTC. Keep at least a full day
  // available even when a job starts immediately before midnight.
  const expirationDate = new Date(now() + 2 * 86_400_000).toISOString().slice(0, 10);
  for (const [name, type] of [["SONAR_ADMIN_TOKEN", "USER_TOKEN"], ["SONAR_TOKEN", "PROJECT_ANALYSIS_TOKEN"]]) {
    const params = { name: `nest-ci-${type}`, type, expirationDate };
    if (type === "PROJECT_ANALYSIS_TOKEN") params.projectKey = policy.projectKey;
    const { token } = await admin("api/user_tokens/generate", params, "POST");
    if (!token) throw new Error("SonarQube did not return a CI token.");
    mask(token);
    publish(name, token);
  }
  console.log("Disposable SonarQube is ready; CI credentials expire within two days.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await bootstrapSonar();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
