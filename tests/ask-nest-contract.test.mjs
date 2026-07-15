import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("Ask Nest keeps Azure credentials server-side and uses the v1 Responses API", async () => {
  const config = await source("lib/ai/config.ts");
  const client = await source("lib/ai/ask-nest.ts");

  assert.match(config, /process\.env\.AI_WORKLOAD_ENDPOINT/);
  assert.match(config, /process\.env\.AI_WORKLOAD_API_KEY/);
  assert.match(config, /process\.env\.AI_WORKLOAD_MODEL/);
  assert.match(config, /\/openai\/v1/);
  assert.match(client, /client\.responses\.create/);
  assert.match(client, /store:\s*false/);
  assert.match(client, /include:\s*\["reasoning\.encrypted_content"\]/);
  assert.doesNotMatch(config, /NEXT_PUBLIC_/);
});

test("Ask Nest derives workspace scope from the session and never accepts a workspace id", async () => {
  const route = await source("app/api/ai/ask/route.ts");
  const orchestration = await source("lib/ai/ask-nest.ts");

  assert.match(route, /const \{ userId, workspaceId \} = await requireWorkspaceAccess\(\)/);
  const requestSchema = route.slice(route.indexOf("const AskNestRequestSchema"), route.indexOf("const PRIVATE_HEADERS"));
  assert.doesNotMatch(requestSchema, /workspaceId/);
  assert.doesNotMatch(requestSchema, /pageTitle/);
  assert.match(route, /pageTitle:\s*PAGE_TITLES\[parsed\.data\.pagePath\]/);
  assert.match(route, /consumeAskNestRateLimit\(userId\)/);
  assert.match(route, /Cache-Control["']?:\s*["']private, no-store/);
  assert.doesNotMatch(orchestration, /Current workspace:\s*\$\{/);
});

test("Ask Nest exposes only bounded read tools", async () => {
  const tools = await source("lib/ai/ask-nest-tools.ts");
  const expectedTools = [
    "get_financial_snapshot",
    "compare_spending",
    "find_transactions",
    "find_card_transactions",
    "get_card_obligations",
    "get_receivables",
    "get_budget_plan",
    "explain_reconciliation",
  ];

  for (const name of expectedTools) {
    assert.match(tools, new RegExp(`name: ["']${name}["']`));
    assert.match(tools, new RegExp(`case ["']${name}["']`));
  }
  assert.match(tools, /MAX_RANGE_DAYS\s*=\s*731/);
  assert.match(tools, /take:\s*args\.limit/);
  assert.doesNotMatch(tools, /prisma\.\w+\.(?:create|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(tools, /rawBody|accessToken|refreshToken|encryptedCardNumber/);
});

test("Ask Nest validates structured answers and grounds displayed currency values", async () => {
  const orchestration = await source("lib/ai/ask-nest.ts");

  assert.match(orchestration, /type:\s*["']json_schema["']/);
  assert.match(orchestration, /strict:\s*true/);
  assert.match(orchestration, /GeneratedAnswerSchema\.parse/);
  assert.match(orchestration, /assertGroundedCurrencyValues\(generated, toolOutputs\)/);
  assert.match(orchestration, /evidenceById\.get\(id\)/);
});

test("Ask Nest uses an accessible, session-only panel in the shared shell", async () => {
  const shell = await source("components/app-shell.tsx");
  const panel = await source("components/ask-nest.tsx");
  const styles = await source("app/globals.css");

  assert.match(shell, /<AskNest/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="true"/);
  assert.match(panel, /Supporting data/);
  assert.match(panel, /Read-only/);
  assert.match(panel, /history:\s*getHistory|const history = getHistory/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.ask-nest-panel/);
});
