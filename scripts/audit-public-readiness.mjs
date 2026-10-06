import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const gitExecutable = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
const tracked = execFileSync(gitExecutable, ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const untracked = execFileSync(
  gitExecutable,
  ["ls-files", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const files = [...new Set([...tracked, ...untracked])];

const requiredFiles = [
  ".env.example",
  ".github/CODEOWNERS",
  "README.md",
  "SECURITY.md",
];
const forbiddenPaths = [
  /^\.env(?:\.|$)(?!example$)/,
  /^\.sfdx\//,
  /^\.claude\/settings\.local\.json$/,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)next-env\.d\.ts$/,
  /(?:^|\/)tsconfig\.tsbuildinfo$/,
  /\.(?:pem|p12|pfx)$/i,
];
const contentRules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/],
  ["AWS access key", /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["live Stripe key", /(?:sk|rk)_live_[0-9A-Za-z]{16,}/],
  ["Slack token", /xox[baprs]-[0-9A-Za-z-]{10,}/],
  ["SendGrid key", /SG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}/],
  ["Azure account key", /AccountKey=[A-Za-z0-9+/=]{20,}/],
  [
    "credentialed database URL",
    /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|sqlserver):\/\/[^\s:@/]+:[^\s@/]+@/i,
  ],
  ["absolute user path", /(?:\/Users\/[A-Za-z0-9._-]+\/|[A-Z]:\\Users\\[^\\]+\\)/],
];

const findings = [];

for (const required of requiredFiles) {
  if (!existsSync(path.join(root, required))) {
    findings.push({ rule: "missing public-readiness file", file: required });
  }
}

for (const file of tracked) {
  if (!existsSync(path.join(root, file))) continue;
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    findings.push({ rule: "forbidden tracked artifact", file });
  }
}

for (const file of files) {
  const absolute = path.join(root, file);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(absolute, "r");
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 5_000_000) continue;
    bytes = readFileSync(descriptor);
  } catch {
    continue;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (bytes.includes(0)) continue;
  const content = bytes.toString("utf8");
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(content)) findings.push({ rule, file });
  }
}

if (findings.length) {
  console.error("Public-readiness audit failed:");
  for (const finding of findings) {
    console.error(`- ${finding.rule}: ${finding.file}`);
  }
  process.exit(1);
}

console.log(`Public-readiness audit passed (${files.length} files scanned; values not printed).`);
if (!existsSync(path.join(root, "LICENSE")) && !existsSync(path.join(root, "LICENSE.md"))) {
  console.warn("Warning: no open-source license has been selected.");
}
