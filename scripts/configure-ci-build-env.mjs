import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { setSecret } from "@actions/core";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || !process.env.GITHUB_ENV) {
  throw new Error("Build environment setup is restricted to disposable GitHub-hosted runners.");
}

// Schema generation and Next.js builds need configuration, but never production access.
const password = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
for (const secret of [password, authSecret]) setSecret(secret);
await appendFile(process.env.GITHUB_ENV, [
  `DATABASE_URL=sqlserver://127.0.0.1:1433;database=nest_build;user=nest_build;password=${password};encrypt=true;trustServerCertificate=false`,
  `SHADOW_DATABASE_URL=sqlserver://127.0.0.1:1433;database=nest_build_shadow;user=nest_build;password=${password};encrypt=true;trustServerCertificate=false`,
  `NEXTAUTH_SECRET=${authSecret}`,
  "NEXTAUTH_URL=http://127.0.0.1:3100",
  "",
].join("\n"));
