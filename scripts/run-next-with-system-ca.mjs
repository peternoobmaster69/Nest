import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (!new Set(["dev", "build", "start"]).has(command)) {
  console.error("Usage: node scripts/run-next-with-system-ca.mjs <dev|build|start> [...args]");
  process.exit(1);
}

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const nodeArguments = [
  nextCli,
  command,
  ...process.argv.slice(3),
];
const supportsSystemCa = process.allowedNodeEnvironmentFlags.has("--use-system-ca");
const result = spawnSync(process.execPath, nodeArguments, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(supportsSystemCa ? { NODE_USE_SYSTEM_CA: "1" } : {}),
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to start Next.js: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
