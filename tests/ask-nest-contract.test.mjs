import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readAppStyles } from "./read-app-styles.mjs";

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

test("Ask Nest personalizes greetings with the authenticated user's profile name", async () => {
  const [orchestration, shell, panel] = await Promise.all([
    source("lib/ai/ask-nest.ts"),
    source("components/app-shell.tsx"),
    source("components/ask-nest.tsx"),
  ]);

  assert.match(orchestration, /prisma\.user\.findUnique\([\s\S]*?where: \{ id: input\.userId \}[\s\S]*?select: \{ name: true \}/);
  assert.match(orchestration, /userName: normalizeAuthenticatedUserName\(user\?\.name\)/);
  assert.match(orchestration, /Authenticated user display name \(untrusted profile data\)/);
  assert.match(orchestration, /display name is not null[\s\S]*?Greet them by name when they greet you or begin a new conversation/);
  assert.match(orchestration, /Do not repeat the name mechanically/);
  assert.match(shell, /<AskNest[\s\S]*?userName=\{userName\}/);
  assert.match(panel, /greetingName \? `Hi \$\{greetingName\}, ask about the money already in Nest`/);
});

test("Ask Nest exposes only bounded read tools", async () => {
  const tools = await source("lib/ai/ask-nest-tools.ts");
  const expectedTools = [
    "get_financial_snapshot",
    "compare_spending",
    "get_category_spending",
    "find_transactions",
    "find_card_transactions",
    "get_card_obligations",
    "get_receivables",
    "get_budget_plan",
    "explain_reconciliation",
    "get_spending_breakdown",
    "get_investment_summary",
    "get_market_history",
    "search_market_news",
    "get_trip_spending",
    "explain_cash_flow_change",
    "compare_income",
    "get_top_spending_drivers",
    "get_budget_vs_actual",
    "find_recurring_spend",
  ];

  for (const name of expectedTools) {
    assert.match(tools, new RegExp(`name: ["']${name}["']`));
    assert.match(tools, new RegExp(`case ["']${name}["']`));
  }
  assert.match(tools, /MAX_RANGE_DAYS\s*=\s*731/);
  assert.match(tools, /take:\s*args\.limit/);
  assert.doesNotMatch(tools, /prisma\.\w+\.(?:create|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(tools, /rawBody|accessToken|refreshToken|encryptedCardNumber/);
  assert.match(tools, /transactionHref/);
  assert.match(tools, /view["'],\s*["']ask-nest/);
});

test("Ask Nest validates structured answers and grounds displayed currency values", async () => {
  const orchestration = await source("lib/ai/ask-nest.ts");

  assert.match(orchestration, /type:\s*["']json_schema["']/);
  assert.match(orchestration, /strict:\s*true/);
  assert.match(orchestration, /GeneratedAnswerSchema\.parse/);
  assert.match(orchestration, /assertGroundedCurrencyValues\(generated, toolOutputs\)/);
  assert.match(orchestration, /evidenceById\.get\(id\)/);
});

test("Ask Nest distinguishes outstanding statements from distinct credit cards", async () => {
  const [orchestration, tools] = await Promise.all([
    source("lib/ai/ask-nest.ts"),
    source("lib/ai/ask-nest-tools.ts"),
  ]);

  assert.match(tools, /statementCount counts statements and cardCount counts distinct cards/);
  assert.match(tools, /const cardCount = new Set\(statements\.map\(\(statement\) => statement\.cardId\)\)\.size/);
  assert.match(tools, /statementCount,[\s\S]*?cardCount,[\s\S]*?summary:/);
  assert.match(tools, /nextStatements: outstandingCardStatements\.slice/);
  assert.match(tools, /outstandingCardStatements:\s*\{[\s\S]*?\.\.\.cardStatementSummary/);
  assert.doesNotMatch(tools, /cardObligations:\s*\{/);
  assert.match(tools, /ALL_CARD_STATEMENTS_HREF = "\/credit-transactions\?cardId=all&month=all"/);
  assert.match(tools, /"All recorded payment due dates",[\s\S]*?ALL_CARD_STATEMENTS_HREF/);
  assert.match(orchestration, /Say “statements” when using statementCount/);
  assert.match(orchestration, /never describe statementCount as the number of cards/);
});

test("Ask Nest reports the specific reason a response could not be grounded", async () => {
  const [orchestration, route, panel] = await Promise.all([
    source("lib/ai/ask-nest.ts"),
    source("app/api/ai/ask/route.ts"),
    source("components/ask-nest.tsx"),
  ]);

  for (const code of [
    "AI_LOOKUP_LIMIT",
    "AI_LOOKUP_ROUNDS_EXHAUSTED",
    "AI_INVALID_TOOL_FILTERS",
    "AI_NO_MATCHING_DATA",
    "AI_OUTPUT_LIMIT",
    "AI_CONTENT_FILTERED",
    "AI_UNGROUNDED_VALUE",
    "AI_AMBIGUOUS_CURRENCY",
  ]) {
    assert.match(orchestration, new RegExp(code));
  }
  assert.match(orchestration, /not too many transaction results/);
  assert.match(orchestration, /incomplete_details\?\.reason/);
  assert.match(route, /errorResponse\(error\.publicMessage, error\.code, error\.status\)/);
  assert.doesNotMatch(route, /could not produce a grounded answer\. Try rephrasing/);
  assert.match(panel, /payload\.code/);
  assert.match(panel, /Edit question/);
  assert.match(panel, /Retry same question/);
  assert.match(panel, /ASK_NEST_ERROR_LABELS/);
});

test("Ask Nest uses an accessible panel with persisted, lazy-loaded history", async () => {
  const shell = await source("components/app-shell.tsx");
  const panel = await source("components/ask-nest.tsx");
  const styles = await readAppStyles(root);

  assert.match(shell, /<AskNest/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="true"/);
  assert.match(panel, /Supporting data/);
  assert.match(panel, /Read-only/);
  assert.match(panel, /history:\s*getHistory|const history = getHistory/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.match(panel, /\/api\/ai\/history\?limit=10/);
  assert.match(panel, /Load older conversations/);
  assert.match(panel, /renderWithFormattedDates/);
  assert.match(panel, /AskNestVisualizationView/);
  assert.match(panel, /formatChartPeriodLabel/);
  assert.match(panel, /Most recent chart values/);
  assert.match(panel, /coordinates\.length \/ 4/);
  assert.match(panel, /ask-nest-trip-flag/);
  assert.match(panel, /Select one to add it to the message box/);
  assert.match(panel, /chooseFollowUp\(followUp\)/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => void ask\(followUp\)\}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.ask-nest-panel/);
  assert.match(panel, /ask-nest-input-shell/);
  assert.match(styles, /\.ask-nest-input-shell:focus-within/);
});

test("Ask Nest uses semantic categories independently of sub-account names", async () => {
  const orchestration = await source("lib/ai/ask-nest.ts");
  const tools = await source("lib/ai/ask-nest-tools.ts");
  const categories = await source("lib/ai/transaction-categories.mjs");

  assert.match(tools, /name: ["']get_category_spending["']/);
  assert.match(tools, /DETERMINISTIC_TRANSACTION_CLASSIFICATION/);
  assert.match(tools, /possibleAdditionalCents/);
  assert.doesNotMatch(tools, /implicitBudgetQuery/);
  assert.match(categories, /SimplyGo/i);
  assert.match(categories, /AMBIGUOUS_GRAB/);
  assert.match(orchestration, /Never add possibleAdditional to it/);
});

test("Ask Nest derives charts and trip cards from successful tool output", async () => {
  const [orchestration, tools, panel] = await Promise.all([
    source("lib/ai/ask-nest.ts"),
    source("lib/ai/ask-nest-tools.ts"),
    source("components/ask-nest.tsx"),
  ]);

  assert.match(orchestration, /resolveVisualization\(successfulToolOutputs\)/);
  assert.match(tools, /type:\s*["']trip_cards["']/);
  assert.match(tools, /type:\s*["']trend_chart["']/);
  assert.match(tools, /type:\s*["']investment_chart["']/);
  assert.match(tools, /items: rows\.filter[\s\S]*?id: row\.id,[\s\S]*?label: row\.name/);
  assert.match(panel, /ask-nest-investment-row" key=\{item\.id\}/);
  assert.match(tools, /groupId:\s*group\.id/);
  assert.match(tools, /destination_hints/);
  assert.match(tools, /TRANSACTION_TEXT_ESTIMATE/);
  assert.match(tools, /Estimated from transaction text matches/);
  assert.match(orchestration, /If get_trip_spending marks a result as estimated/);
});

test("Transactions supports Ask Nest deep links and multiple custom months", async () => {
  const [page, monthList] = await Promise.all([
    source("components/transactions-page.tsx"),
    source("components/transactions/transaction-month-list.tsx"),
  ]);
  const route = await source("app/api/transactions/route.ts");
  const tools = await source("lib/ai/ask-nest-tools.ts");
  const styles = await readAppStyles(root);

  assert.match(page, /searchParams\.get\(["']view["']\) === ["']ask-nest["']/);
  assert.match(page, /searchParams\.get\(["']transactionId["']\)/);
  assert.match(page, /params\.set\(["']transactionId["'], targetTransactionId\)/);
  assert.match(page, /document\.getElementById\(`transaction-\$\{targetTransactionId\}`\)/);
  assert.match(page, /targetId=\{targetTransactionId\}/);
  assert.match(monthList, /deepLinked \? ["'] is-deep-linked["']/);
  assert.match(route, /transactionId \? \{ id: transactionId \} : \{\}/);
  assert.match(tools, /function transactionRecordEvidence/);
  assert.match(tools, /accountId: row\.accountId[\s\S]*?budgetId: row\.budgetId[\s\S]*?transactionId: row\.id/);
  assert.match(tools, /categoryEvidenceItems = transactionEvidence\.length \? transactionEvidence : \[categoryEvidence\]/);
  assert.match(styles, /\.tx-recent-row\.is-deep-linked/);
  assert.match(page, /selectedCustomMonths/);
  assert.match(page, /draftCustomMonths/);
  assert.match(page, /Apply \{draftCustomMonths\.length/);
  assert.match(page, /params\.set\(["']months["']/);
  assert.match(route, /selectedMonthKeys\.length > 24/);
  assert.match(route, /selectedMonthRanges\.map/);
});

test("Ask Nest history is scoped to the authenticated user and workspace", async () => {
  const history = await source("app/api/ai/history/route.ts");
  const ask = await source("app/api/ai/ask/route.ts");
  const schema = await source("prisma/schema.prisma");

  assert.match(history, /const \{ userId, workspaceId \} = await requireWorkspaceAccess\(\)/);
  assert.match(history, /where: \{ workspaceId, userId \}/);
  assert.match(history, /take: limit \+ 1/);
  assert.match(history, /nextCursor/);
  assert.match(ask, /prisma\.askNestTurn\.create/);
  assert.match(schema, /model AskNestTurn/);
  assert.match(schema, /@@index\(\[workspaceId, userId, createdAt\]\)/);
});

test("Ask Nest persists provider token usage for administration", async () => {
  const [orchestration, ask, schema, admin] = await Promise.all([
    source("lib/ai/ask-nest.ts"),
    source("app/api/ai/ask/route.ts"),
    source("prisma/schema.prisma"),
    source("lib/admin-overview.ts"),
  ]);

  assert.match(orchestration, /response\.usage/);
  assert.match(orchestration, /tokenUsage: hasTokenUsage \? tokenUsage : null/);
  assert.match(ask, /inputTokens: result\.tokenUsage\?\.inputTokens/);
  assert.match(schema, /inputTokens Int\?/);
  assert.match(schema, /outputTokens Int\?/);
  assert.match(schema, /totalTokens Int\?/);
  assert.match(admin, /allTimeTokens/);
  assert.match(admin, /trackedTokenTurnCount/);
});

test("Ask Nest retains usage summaries while a daily guarded job purges raw history", async () => {
  const [retention, route, schema, vercel, readme, admin] = await Promise.all([
    source("lib/ai/ask-nest-retention.ts"),
    source("app/api/cron/ask-nest-retention/route.ts"),
    source("prisma/schema.prisma"),
    source("vercel.json"),
    source("README.md"),
    source("lib/admin-overview.ts"),
  ]);

  assert.match(retention, /DEFAULT_RETENTION_DAYS = 90/);
  assert.match(retention, /ASK_NEST_HISTORY_RETENTION_DAYS/);
  assert.match(retention, /UPDLOCK, READPAST, ROWLOCK/);
  assert.match(retention, /askNestUsageDaily\.upsert/);
  assert.match(retention, /askNestMemory\.updateMany/);
  assert.match(retention, /askNestTurn\.deleteMany/);
  assert.match(route, /authorizeCronRequest\(request\)/);
  assert.match(route, /runAskNestRetention\(\)/);
  assert.match(schema, /model AskNestUsageDaily/);
  assert.match(schema, /@@unique\(\[day, workspaceId, userId\]\)/);
  assert.match(vercel, /api\/cron\/ask-nest-retention/);
  assert.match(readme, /ASK_NEST_HISTORY_RETENTION_DAYS/);
  assert.match(admin, /archivedUsage/);
});

test("clearing Ask Nest chat archives usage before deleting raw turns", async () => {
  const [history, retention, admin] = await Promise.all([
    source("app/api/ai/history/route.ts"),
    source("lib/ai/ask-nest-retention.ts"),
    source("lib/admin-overview.ts"),
  ]);

  assert.match(history, /clearAskNestHistoryPreservingUsage\(\{ workspaceId, userId \}\)/);
  assert.doesNotMatch(history, /prisma\.askNestTurn\.deleteMany/);
  assert.match(retention, /export async function clearAskNestHistoryPreservingUsage/);
  assert.match(retention, /UPDLOCK, HOLDLOCK, ROWLOCK/);
  assert.match(retention, /archiveAskNestTurns\(tx, turns\)/);
  assert.match(retention, /askNestUsageDaily\.upsert/);
  assert.match(retention, /askNestTurn\.deleteMany/);
  assert.match(admin, /archivedRecentUsage/);
  assert.match(admin, /addTokenTotals\(tokenTotals\(recentTokens\), tokenTotals\(archivedRecentUsage\)\)/);
});

test("Ask Nest memory is explicit, scoped, reviewable, and never a financial source", async () => {
  const orchestration = await source("lib/ai/ask-nest.ts");
  const memory = await source("lib/ai/memory.ts");
  const route = await source("app/api/ai/memory/route.ts");
  const askRoute = await source("app/api/ai/ask/route.ts");
  const panel = await source("components/ask-nest.tsx");
  const schema = await source("prisma/schema.prisma");

  assert.match(orchestration, /memory_candidates/);
  assert.match(orchestration, /loadRelevantAskNestMemories/);
  assert.match(orchestration, /loadRelevantAskNestTopics/);
  assert.match(orchestration, /never reuse their old financial figures/);
  assert.match(orchestration, /never a source for financial facts/);
  assert.match(memory, /EXPLICIT_MEMORY_PATTERN/);
  assert.match(memory, /UNSAFE_MEMORY_PATTERN/);
  assert.match(memory, /FINANCIAL_FACT_PATTERN/);
  assert.match(memory, /getAskNestOwnerHash/);
  assert.match(askRoute, /saveAskNestMemories/);
  assert.match(route, /const \{ userId, workspaceId \} = await requireWorkspaceAccess\(\)/);
  assert.match(route, /ownerHash/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(panel, /What Ask Nest remembers/);
  assert.match(panel, /Forget everything/);
  assert.match(panel, /Financial figures are always loaded fresh/);
  assert.match(schema, /model AskNestMemory/);
  assert.match(schema, /@@unique\(\[ownerHash, keyHash\]\)/);
});

test("Ask Nest records bounded quality diagnostics and accepts scoped usefulness feedback", async () => {
  const [orchestration, askRoute, feedbackRoute, schema, panel, retention] = await Promise.all([
    source("lib/ai/ask-nest.ts"),
    source("app/api/ai/ask/route.ts"),
    source("app/api/ai/feedback/route.ts"),
    source("prisma/schema.prisma"),
    source("components/ask-nest.tsx"),
    source("lib/ai/ask-nest-retention.ts"),
  ]);
  assert.match(orchestration, /toolDiagnostics/);
  assert.match(orchestration, /diagnosticArguments/);
  assert.match(orchestration, /emptyResultCount/);
  assert.match(askRoute, /diagnosticsJson: JSON\.stringify\(result\.diagnostics\)/);
  assert.match(feedbackRoute, /where: \{ id: parsed\.data\.turnId, workspaceId, userId \}/);
  assert.match(panel, /Was this useful\?/);
  assert.match(panel, /WRONG_DATA/);
  assert.match(schema, /feedbackRating String\?/);
  assert.match(retention, /helpfulCount/);
  assert.match(retention, /notHelpfulCount/);
});

test("Ask Nest hybrid knowledge search is workspace-filtered and evaluation-gated", async () => {
  const [search, orchestration, tools] = await Promise.all([
    source("lib/ai/knowledge-search.ts"),
    source("lib/ai/ask-nest.ts"),
    source("lib/ai/ask-nest-tools.ts"),
  ]);
  assert.match(search, /ASK_NEST_SEARCH_EVAL_PASS/);
  assert.match(search, /workspaceId eq/);
  assert.match(search, /userId eq/);
  assert.match(search, /filterMode: "preFilter"/);
  assert.match(search, /kind: "text"/);
  assert.match(search, /queryType: "semantic"/);
  assert.match(orchestration, /routing\.needsHybridRetrieval/);
  assert.match(tools, /search_workspace_knowledge/);
});
