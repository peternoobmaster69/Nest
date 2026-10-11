import assert from "node:assert/strict";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { calls, dataCalls, given, require } from "./finance-route-harness.mjs";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
let adminSession, adminError, adminChecks, routeWorkspaceId, frames, jobActions;
mock.module("../lib/admin-auth.ts", { namedExports: { async requireAdminPage() {
  adminChecks += 1;
  if (adminError) throw adminError;
  return adminSession;
} } });
mock.module("../components/workspace-provider.tsx", { namedExports: { useWorkspaceId: () => routeWorkspaceId } });
mock.module("../components/page-frame.tsx", { namedExports: { PageFrame: props => {
  frames.push(props);
  return ui.h("main", null, props.children);
} } });
mock.module("../app/admin/job-actions.ts", { namedExports: {
  retryJobAction: async form => { jobActions.push(["retry", form.get("jobId")]); },
  cancelJobAction: async form => { jobActions.push(["cancel", form.get("jobId")]); },
} });
const { getAdminOverview } = require("../lib/admin-overview.ts");
const { default: AdminPage } = require("../app/admin/page.tsx");
const { AdminDirectories } = require("../components/admin-directories.tsx");
const { AdminRecentActivityTable, AdminBackgroundJobsTable } = require("../components/admin-record-tables.tsx");
const { AdminNavigation } = require("../components/admin-navigation.tsx");
const now = new Date("2026-10-10T12:00:00Z");
const envKeys = ["ADMIN", "AI_WORKLOAD_ENDPOINT", "AI_WORKLOAD_API_KEY", "AI_WORKLOAD_MODEL", "AI_WORKLOAD_INPUT_COST_PER_1M_USD", "AI_WORKLOAD_OUTPUT_COST_PER_1M_USD", "ASK_NEST_HISTORY_RETENTION_DAYS", "ASK_NEST_SEARCH_ENABLED", "ASK_NEST_SEARCH_EVAL_PASS", "AZURE_SEARCH_ENDPOINT", "AZURE_SEARCH_INDEX"];
const sum = (values = {}) => ({ _sum: { inputTokens: null, outputTokens: null, totalTokens: null, turnCount: null, trackedTurnCount: null, toolCallCount: null, emptyResultCount: null, totalDurationMs: null, feedbackCount: null, helpfulCount: null, notHelpfulCount: null, ...values } });
const turn = (id, extra = {}) => ({ id, question: `Question ${id}`, pagePath: "/transactions", createdAt: now, workspace: { name: "Household" }, user: { name: "Alice", email: "alice@example.test" }, inputTokens: 100, outputTokens: 50, totalTokens: 150, toolCallCount: 2, emptyResultCount: 0, durationMs: 1200, feedbackRating: "HELPFUL", feedbackReason: null, answerJson: JSON.stringify({ scope: { toolsUsed: ["ledger"] }, evidence: [{}], memoryUpdates: [] }), ...extra });
const user = (id, extra = {}) => ({ id, name: id, email: `${id}@example.test`, createdAt: now, lastSignedInAt: null, loginSessions: [], activeWorkspaceId: "home", memberships: [], _count: { askNestTurns: 5, askNestMemories: 2 }, ...extra });
const workspace = (id, extra = {}) => ({ id, name: id, baseCurrency: "SGD", isShared: false, createdAt: now, updatedAt: now, members: [], _count: { members: 0, financials: 1, transactions: 4, budgetEnvelopes: 2, creditCards: 1, receivables: 0, investmentAccounts: 0, askNestTurns: 5, askNestMemories: 2 }, ...extra });
const job = (id, extra = {}) => ({ id, type: "GMAIL_SYNC", key: null, status: "PENDING", workspaceId: "home", userId: "alice", progress: 25, current: 1, total: 4, message: null, errorCode: null, attempts: 1, retryCount: 0, duplicateCount: 0, availableAt: now, leaseExpiresAt: null, startedAt: null, finishedAt: null, createdAt: now, updatedAt: now, ...extra });

function emptyData() {
  given("user.count", 0);
  given("workspace.count", 0);
  given("askNestTurn.count", 0, 0, 0, 0, 0);
  given("askNestMemory.count", 0, 0);
  given("askNestMemory.groupBy", []);
  given("askNestTurn.findMany", []);
  given("user.findMany", []);
  given("workspace.findMany", []);
  given("askNestTurn.aggregate", sum(), sum(), sum());
  given("askNestUsageDaily.aggregate", sum(), sum());
  given("askNestUsageDaily.groupBy", [], []);
  given("$queryRaw", []);
  given("backgroundJob.groupBy", []);
  given("backgroundJob.findMany", [], []);
  given("backgroundJob.findFirst", null);
}

beforeEach(t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const saved = envKeys.map(key => [key, process.env[key]]);
  for (const key of envKeys) delete process.env[key];
  t.after(() => { for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  } });
  adminSession = { user: { name: "Administrator", email: "admin@example.test", image: "/avatar.png" } };
  adminError = null;
  adminChecks = 0;
  routeWorkspaceId = "home";
  frames = [];
  jobActions = [];
  emptyData();
});
afterEach(() => ui.cleanup());
after(() => ui.dispose());

test("an empty admin overview uses zero totals, a healthy empty queue and unavailable optional configuration", async () => {
  const overview = await getAdminOverview();
  assert.deepEqual(overview.stats, { totalUsers: 0, totalWorkspaces: 0, totalTurns: 0, recentTurnCount: 0, activeMemoryCount: 0, inactiveMemoryCount: 0 });
  assert.deepEqual(overview.tokenUsage, { allTime: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, last7Days: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, trackedTurnCount: 0, estimatedCost: null });
  assert.deepEqual(overview.quality, { toolCallCount: 0, emptyResultCount: 0, emptyResultRate: 0, feedbackCount: 0, helpfulCount: 0, notHelpfulCount: 0, helpfulRate: 0 });
  assert.deepEqual(overview.backgroundJobs.metrics, { queued: 0, running: 0, succeeded: 0, failed: 0, deadLetters: 0, retries: 0, duplicateSuppressions: 0, queueAgeMs: 0, averageDurationMs: 0, successRate: 1 });
  assert.equal(overview.databaseStorage, null);
  assert.equal(overview.configuration.aiModel, null);
  assert.equal(overview.configuration.askNestHistoryRetentionDays, 90);
  assert.equal(overview.configuration.askNestSearch.active, false);
  assert.equal(dataCalls("askNestTurn.findMany")[0].take, 25);
  assert.equal(dataCalls("backgroundJob.findMany")[0].take, 50);
  assert.equal(dataCalls("backgroundJob.findMany")[1].take, 1000);
  assert.equal(Object.hasOwn(dataCalls("backgroundJob.findMany")[0].select, "checkpointJson"), false);
  assert.deepEqual(dataCalls("askNestUsageDaily.aggregate")[1].where, { day: { gte: "2026-10-03" } });
});

test("admin usage combines retained turns and archived counters without losing user or workspace totals", async () => {
  process.env.AI_WORKLOAD_INPUT_COST_PER_1M_USD = "2";
  process.env.AI_WORKLOAD_OUTPUT_COST_PER_1M_USD = "8";
  given("user.count", 3);
  given("workspace.count", 3);
  given("askNestTurn.count", 10, 4, 8, 2, 1);
  given("askNestMemory.count", 6, 2);
  given("askNestMemory.groupBy", [{ kind: "BUDGET_PREFERENCE", _count: { _all: 6 } }]);
  given("askNestTurn.aggregate", sum({ inputTokens: 2000000, outputTokens: 500000, totalTokens: 2500000 }), sum({ inputTokens: 100000, outputTokens: 50000, totalTokens: 150000 }), sum({ toolCallCount: 8, emptyResultCount: 1 }));
  given("askNestUsageDaily.aggregate", sum({ inputTokens: 1000000, outputTokens: 500000, totalTokens: 1500000, turnCount: 20, trackedTurnCount: 18, toolCallCount: 12, emptyResultCount: 3, feedbackCount: 8, helpfulCount: 5, notHelpfulCount: 3 }), sum({ inputTokens: 20000, outputTokens: 10000, totalTokens: 30000, turnCount: 3 }));
  given("askNestUsageDaily.groupBy", [{ userId: "alice", _sum: { turnCount: 20 } }, { userId: "bob", _sum: { turnCount: null } }], [{ workspaceId: "home", _sum: { turnCount: 20 } }, { workspaceId: "shared", _sum: { turnCount: null } }]);
  const membership = { role: "OWNER", createdAt: now, workspace: { id: "home", name: "Household" } };
  const login = { ipAddress: "192.0.2.1", countryCode: "SG", signedInAt: now };
  given("user.findMany", [user("alice", { memberships: [membership], loginSessions: [login], lastSignedInAt: now }), user("bob"), user("charlie")]);
  given("workspace.findMany", [workspace("home", { members: [{ role: "OWNER", createdAt: now, user: { id: "alice", name: "Alice", email: "alice@example.test" } }] }), workspace("shared"), workspace("empty")]);
  const overview = await getAdminOverview();
  assert.deepEqual(overview.stats, { totalUsers: 3, totalWorkspaces: 3, totalTurns: 30, recentTurnCount: 7, activeMemoryCount: 6, inactiveMemoryCount: 2 });
  assert.deepEqual(overview.tokenUsage.allTime, { inputTokens: 3000000, outputTokens: 1000000, totalTokens: 4000000 });
  assert.deepEqual(overview.tokenUsage.last7Days, { inputTokens: 120000, outputTokens: 60000, totalTokens: 180000 });
  assert.equal(overview.tokenUsage.trackedTurnCount, 26);
  assert.equal(overview.tokenUsage.estimatedCost.allTime.totalCostUsd, 14);
  assert.ok(Math.abs(overview.tokenUsage.estimatedCost.last7Days.totalCostUsd - 0.72) < 1e-12);
  assert.deepEqual(overview.quality, { toolCallCount: 20, emptyResultCount: 4, emptyResultRate: 0.2, feedbackCount: 11, helpfulCount: 7, notHelpfulCount: 4, helpfulRate: 7 / 11 });
  assert.deepEqual(overview.memoryKinds, [{ kind: "BUDGET_PREFERENCE", count: 6 }]);
  assert.deepEqual(overview.users.map(value => value.counts.askNestTurns), [25, 5, 5]);
  assert.deepEqual(overview.workspaces.map(value => value.counts.askNestTurns), [25, 5, 5]);
  assert.deepEqual(overview.users[0].latestLoginSession, login);
  assert.equal(overview.users[1].latestLoginSession, null);
  assert.deepEqual(overview.users[0].memberships, [{ workspaceId: "home", workspaceName: "Household", role: "OWNER", joinedAt: now }]);
  assert.deepEqual(overview.workspaces[0].members, [{ userId: "alice", userName: "Alice", userEmail: "alice@example.test", role: "OWNER", joinedAt: now }]);
});

test("recent admin activity sanitizes answer metadata and distinguishes untracked tokens and missing user labels", async () => {
  process.env.AI_WORKLOAD_INPUT_COST_PER_1M_USD = "2";
  process.env.AI_WORKLOAD_OUTPUT_COST_PER_1M_USD = "8";
  given("askNestTurn.findMany", [
    turn("complete", { answerJson: JSON.stringify({ scope: { toolsUsed: ["ledger", 3, "budget"] }, evidence: [{}, {}], memoryUpdates: [{}], privateDiagnostics: "never return" }) }),
    turn("invalid", { answerJson: "{", totalTokens: null, inputTokens: null, outputTokens: null, user: { name: null, email: "fallback@example.test" } }),
    turn("null", { answerJson: "null", user: { name: null, email: null }, totalTokens: 0, inputTokens: null, outputTokens: null }),
    turn("wrong-types", { answerJson: JSON.stringify({ scope: { toolsUsed: "ledger" }, evidence: "wrong", memoryUpdates: {} }) }),
    turn("absent", { answerJson: "{}" }),
  ]);
  const { recentTurns } = await getAdminOverview();
  assert.deepEqual(recentTurns[0].toolsUsed, ["ledger", "budget"]);
  assert.equal(recentTurns[0].evidenceCount, 2);
  assert.equal(recentTurns[0].memoryUpdateCount, 1);
  assert.ok(Math.abs(recentTurns[0].estimatedCostUsd - 0.0006) < 1e-12);
  assert.equal(recentTurns[1].userLabel, "fallback@example.test");
  assert.equal(recentTurns[1].estimatedCostUsd, null);
  assert.equal(recentTurns[2].userLabel, "Unknown user");
  assert.equal(recentTurns[2].estimatedCostUsd, 0);
  for (const item of recentTurns.slice(1)) assert.deepEqual([item.toolsUsed, item.evidenceCount, item.memoryUpdateCount], [[], 0, 0]);
  assert.ok(recentTurns.every(item => !Object.hasOwn(item, "answerJson") && !Object.hasOwn(item, "privateDiagnostics")));
});

for (const [input, output, configured] of [[undefined, "2", false], ["2", undefined, false], [" ", "2", false], ["NaN", "2", false], ["-1", "2", false], ["100001", "2", false], ["0", "0", true], ["100000", "100000", true]]) {
  test(`admin cost rates validate both inclusive limits (${input}, ${output})`, async () => {
    if (input !== undefined) process.env.AI_WORKLOAD_INPUT_COST_PER_1M_USD = input;
    if (output !== undefined) process.env.AI_WORKLOAD_OUTPUT_COST_PER_1M_USD = output;
    given("askNestTurn.findMany", [turn("rate-check")]);
    const overview = await getAdminOverview();
    assert.equal(overview.configuration.aiCostRatesConfigured, configured);
    assert.equal(overview.tokenUsage.estimatedCost !== null, configured);
    assert.equal(overview.recentTurns[0].estimatedCostUsd !== null, configured);
  });
}

test("database storage estimates tolerate missing privileges, numeric driver values and invalid measurements", async () => {
  for (const [rows, expected] of [
    [new Error("Permission denied"), null],
    [[{ dataAllocatedMb: "1536.5", dataUsedMb: 500, logAllocatedMb: 128n, totalAllocatedMb: "1664.5" }], { dataAllocatedMb: 1536.5, dataUsedMb: 500, logAllocatedMb: 128, totalAllocatedMb: 1664.5 }],
    [[{ dataAllocatedMb: Number.POSITIVE_INFINITY, dataUsedMb: -1, logAllocatedMb: "unknown", totalAllocatedMb: null }], { dataAllocatedMb: 0, dataUsedMb: 0, logAllocatedMb: 0, totalAllocatedMb: 0 }],
  ]) {
    emptyData();
    given("$queryRaw", rows);
    assert.deepEqual((await getAdminOverview()).databaseStorage, expected);
  }
});

test("background-job metrics include retries, dead letters, skipped successes and only complete timings", async () => {
  given("backgroundJob.groupBy", [
    { status: "PENDING", _count: { _all: 3 }, _sum: { retryCount: 2, duplicateCount: 4 } },
    ...[["RUNNING", 2], ["SUCCEEDED", 10], ["FAILED", 1], ["DEAD_LETTER", 2]].map(([status, count]) => ({ status, _count: { _all: count }, _sum: { retryCount: null, duplicateCount: null } })),
  ]);
  const recent = [job("pending-one")];
  given("backgroundJob.findMany", recent, [
    { status: "SUCCEEDED", startedAt: new Date(now.getTime() - 1000), finishedAt: now },
    { status: "SKIPPED", startedAt: new Date(now.getTime() - 2000), finishedAt: now },
    { status: "FAILED", startedAt: null, finishedAt: now },
    { status: "FAILED", startedAt: now, finishedAt: null },
  ]);
  given("backgroundJob.findFirst", { createdAt: new Date(now.getTime() - 65000) });
  const overview = await getAdminOverview();
  assert.deepEqual(overview.backgroundJobs.metrics, { queued: 3, running: 2, succeeded: 10, failed: 3, deadLetters: 2, retries: 2, duplicateSuppressions: 4, queueAgeMs: 65000, averageDurationMs: 1500, successRate: 0.5 });
  assert.deepEqual(overview.backgroundJobs.recent, recent);
});

test("the admin page authorizes access before reading any global account or usage data", async () => {
  adminError = new Error("Administrator required");
  await assert.rejects(AdminPage(), /Administrator required/);
  assert.equal(adminChecks, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(frames, []);
});

test("the empty admin page explains unavailable services and supports missing session profile fields", async () => {
  for (const [session, name] of [[{}, "Administrator"], [{ user: { email: "fallback@example.test" } }, "fallback@example.test"]]) {
    emptyData();
    adminSession = session;
    const view = ui.render(await AdminPage());
    assert.equal(frames.at(-1).userName, name);
    assert.equal(frames.at(-1).userImage, null);
    assert.ok(view.getByText("3 missing"));
    assert.ok(view.getByText("No active memories yet."));
    assert.ok(view.getByText(/Cost estimates are unavailable/));
    assert.ok(view.getByText("No Ask Nest interactions have been stored yet."));
    assert.ok(view.getByText("No background jobs have run yet."));
    assert.ok(view.getByText("Not configured"));
    view.unmount();
  }
});

test("the configured admin page formats storage, tiny costs, latency and configuration without exposing secrets", async () => {
  Object.assign(process.env, {
    ADMIN: " admin@example.test ", AI_WORKLOAD_ENDPOINT: " https://provider.example.test ", AI_WORKLOAD_API_KEY: "test-private-provider-key",
    AI_WORKLOAD_MODEL: " finance-model ", AI_WORKLOAD_INPUT_COST_PER_1M_USD: "2", AI_WORKLOAD_OUTPUT_COST_PER_1M_USD: "8",
    ASK_NEST_HISTORY_RETENTION_DAYS: "120", ASK_NEST_SEARCH_ENABLED: "true", ASK_NEST_SEARCH_EVAL_PASS: "true",
    AZURE_SEARCH_ENDPOINT: "https://search.example.test", AZURE_SEARCH_INDEX: "finance",
  });
  given("askNestTurn.count", 1, 1, 1, 1, 0);
  given("askNestTurn.aggregate", sum({ inputTokens: 1, outputTokens: 0, totalTokens: 1 }), sum({ inputTokens: 100, outputTokens: 0, totalTokens: 100 }), sum({ toolCallCount: 1, emptyResultCount: 0 }));
  given("askNestMemory.groupBy", [{ kind: "BUDGET_PREFERENCE", _count: { _all: 2 } }]);
  given("$queryRaw", [{ dataAllocatedMb: 1024, dataUsedMb: 512, logAllocatedMb: 512, totalAllocatedMb: 1536 }]);
  given("backgroundJob.groupBy", [{ status: "DEAD_LETTER", _count: { _all: 1 }, _sum: { retryCount: 2, duplicateCount: 3 } }]);
  given("backgroundJob.findFirst", { createdAt: new Date(now.getTime() - 1500) });
  given("backgroundJob.findMany", [], [{ status: "SUCCEEDED", startedAt: new Date(now.getTime() - 65000), finishedAt: now }]);
  const view = ui.render(await AdminPage());
  assert.equal(frames[0].userName, "Administrator");
  assert.equal(frames[0].userImage, "/avatar.png");
  for (const label of ["Ready", "1.5 GB", "512 MB used", "< $0.0001", "$0.0002", "BUDGET PREFERENCE", "2 sec", "1 min", "finance-model", "120 days", "ACTIVE"])
    assert.ok(view.getByText(label), label);
  assert.ok(!view.container.textContent.includes("test-private-provider-key"));
  assert.deepEqual(view.queryAllByText("https://provider.example.test", { exact: false }), []);
  assert.equal(adminChecks, 1);
});

test("admin directories disclose empty states and close a directory when its trigger is selected again", () => {
  const view = ui.render(ui.h(AdminDirectories, { users: [], workspaces: [] }));
  const users = view.getByRole("button", { name: /^Users/ });
  const workspaces = view.getByRole("button", { name: /^Workspaces/ });
  assert.equal(users.getAttribute("aria-expanded"), "false");
  ui.fireEvent.click(users);
  assert.ok(view.getByText("No registered users."));
  ui.fireEvent.click(users);
  assert.ok(!view.queryByText("No registered users."));
  ui.fireEvent.click(workspaces);
  assert.ok(view.getByText("No workspaces."));
  ui.fireEvent.click(workspaces);
  assert.ok(!view.queryByText("No workspaces."));
});

test("admin directories paginate independently and show optional identities, login locations and membership roles", async () => {
  const users = Array.from({ length: 11 }, (_, index) => user(`user-${index}`));
  users[0] = user("user-0", { lastSignedInAt: now, loginSessions: [{ countryCode: "SG", ipAddress: "192.0.2.1", signedInAt: now }], memberships: [
    { role: "OWNER", createdAt: now, workspace: { id: "home", name: "Home access" } },
    { role: "VIEWER", createdAt: now, workspace: { id: "other", name: "Other access" } },
  ] });
  users[1] = user("user-1", { name: "", email: "", loginSessions: [{ countryCode: null, ipAddress: null, signedInAt: now }] });
  users[2] = user("user-2", { loginSessions: [{ countryCode: "QQ", ipAddress: "192.0.2.2", signedInAt: now }] });
  const workspaces = Array.from({ length: 11 }, (_, index) => workspace(`workspace-${index}`, { isShared: index === 0 }));
  workspaces[0].members = [
    { role: "OWNER", createdAt: now, user: { id: "named", name: "Alice", email: "alice@example.test" } },
    { role: "EDITOR", createdAt: now, user: { id: "email", name: null, email: "email-only@example.test" } },
    { role: "VIEWER", createdAt: now, user: { id: "unknown", name: null, email: null } },
    { role: "VIEWER", createdAt: now, user: { id: "name", name: "Name only", email: null } },
  ];
  given("user.findMany", users);
  given("workspace.findMany", workspaces);
  const overview = await getAdminOverview();
  const view = ui.render(ui.h(AdminDirectories, overview));
  ui.fireEvent.click(view.getByRole("button", { name: /^Users/ }));
  assert.ok(view.getByText("user-0", { selector: "strong" }));
  assert.ok(!view.queryByText("user-10", { selector: "strong" }));
  assert.ok(view.getByText("Unnamed user"));
  assert.ok(view.getByText("No email"));
  assert.ok(view.getByText("Singapore · 192.0.2.1"));
  assert.ok(view.getByText("Country unavailable · IP unavailable"));
  assert.ok(view.getByText("QQ · 192.0.2.2"));
  assert.ok(view.getByText("Active"));
  let pagination = ui.within(view.getByRole("navigation", { name: "Users pagination" }));
  assert.equal(pagination.getByRole("button", { name: "Previous" }).disabled, true);
  ui.fireEvent.click(pagination.getByRole("button", { name: "Next" }));
  assert.ok(view.getByText("user-10", { selector: "strong" }));
  assert.ok(!view.queryByText("user-0", { selector: "strong" }));
  assert.equal(pagination.getByRole("button", { name: "Next" }).disabled, true);
  ui.fireEvent.click(pagination.getByRole("button", { name: "Previous" }));
  ui.fireEvent.click(view.getByRole("button", { name: /^Workspaces/ }));
  assert.ok(view.getByRole("heading", { name: "workspace-0", exact: true }));
  assert.ok(view.getByText("Shared"));
  assert.ok(view.getByText("email-only@example.test"));
  assert.ok(view.getByText("Name only"));
  assert.ok(view.getByText("Unnamed user"));
  assert.ok(view.getAllByText("No members.").length > 0);
  pagination = ui.within(view.getByRole("navigation", { name: "Workspaces pagination" }));
  ui.fireEvent.click(pagination.getByRole("button", { name: "Next" }));
  assert.ok(view.getByRole("heading", { name: "workspace-10", exact: true }));
  ui.fireEvent.click(pagination.getByRole("button", { name: "Previous" }));
  assert.ok(view.getByRole("heading", { name: "workspace-0", exact: true }));
});

test("admin activity tables paginate and distinguish untracked usage, missing grounding and unrated feedback", async () => {
  given("askNestTurn.findMany", [turn("untracked", { totalTokens: null, inputTokens: null, outputTokens: null, durationMs: null, feedbackRating: null, answerJson: "{}" }),
    turn("partial", { inputTokens: null, outputTokens: null, feedbackRating: "NOT_HELPFUL", feedbackReason: "WRONG_SCOPE" }),
    ...Array.from({ length: 9 }, (_, index) => turn(`tracked-${index}`)),
  ]);
  const overview = await getAdminOverview();
  const view = ui.render(ui.h(AdminRecentActivityTable, { turns: overview.recentTurns }));
  assert.ok(view.getByText("Untracked"));
  assert.ok(view.getByText("No tool metadata"));
  assert.ok(view.getByText(/latency untracked/));
  assert.ok(view.getByText("Not rated"));
  assert.ok(view.getByText("NOT HELPFUL"));
  assert.ok(view.getByText("WRONG SCOPE"));
  assert.ok(view.getByText("0 in · 0 out"));
  const pagination = ui.within(view.getByRole("navigation", { name: "Recent activity pagination" }));
  ui.fireEvent.click(pagination.getByRole("button", { name: "Next" }));
  assert.ok(view.getByText("Question tracked-8"));
  ui.fireEvent.click(pagination.getByRole("button", { name: "Previous" }));
  assert.ok(view.getByText("Question untracked"));
});

test("admin job tables expose only actions appropriate to each status and submit the selected job id", async t => {
  const previousFormData = globalThis.FormData;
  globalThis.FormData = ui.window.FormData;
  t.after(() => { globalThis.FormData = previousFormData; });
  const jobs = [
    job("pending-one"), job("running-one", { status: "RUNNING", userId: null, key: "sync-key", message: "Reading mail" }),
    job("failed-one", { status: "FAILED", workspaceId: null, userId: null, key: null, errorCode: "PROVIDER_ERROR", current: null, total: null }),
    job("dead-one", { status: "DEAD_LETTER" }), job("cancelled-one", { status: "CANCELLED" }),
    ...Array.from({ length: 6 }, (_, index) => job(`finished-${index}`, { status: "SUCCEEDED" })),
  ];
  const view = ui.render(ui.h(AdminBackgroundJobsTable, { jobs }));
  assert.ok(view.getByText("System"));
  assert.ok(view.getByText("No actor"));
  assert.ok(view.getByText("sync-key"));
  assert.ok(view.getByText("Reading mail"));
  assert.ok(view.getByText("PROVIDER_ERROR"));
  const row = id => ui.within(view.getByText(id).closest("tr"));
  assert.ok(!row("finished-0").queryByRole("button"));
  assert.ok(!row("failed-one").queryByRole("button", { name: "Cancel" }));
  ui.fireEvent.submit(row("failed-one").getByRole("button", { name: "Retry" }).closest("form"));
  ui.fireEvent.submit(row("pending-one").getByRole("button", { name: "Cancel" }).closest("form"));
  await ui.waitFor(() => assert.deepEqual(jobActions, [["retry", "failed-one"], ["cancel", "pending-one"]]));
  const pagination = ui.within(view.getByRole("navigation", { name: "Background jobs pagination" }));
  ui.fireEvent.click(pagination.getByRole("button", { name: "Next" }));
  assert.ok(view.getByText("finished-5"));
  ui.fireEvent.click(pagination.getByRole("button", { name: "Previous" }));
  assert.ok(view.getByText("pending-one"));
});

test("admin navigation preserves optional workspace scope and marks both overview and agent destinations", () => {
  const view = ui.render(ui.h(AdminNavigation, { current: "overview" }));
  assert.equal(view.getByRole("link", { name: "Overview" }).getAttribute("href"), "/w/home/admin");
  assert.equal(view.getByRole("link", { name: "Overview" }).getAttribute("aria-current"), "page");
  routeWorkspaceId = null;
  view.rerender(ui.h(AdminNavigation, { current: "agents" }));
  assert.equal(view.getByRole("link", { name: "Agents" }).getAttribute("href"), "/admin/agents");
  assert.equal(view.getByRole("link", { name: "Agents" }).getAttribute("aria-current"), "page");
});

test("single-page admin records display their rows without redundant pagination controls", async () => {
  given("askNestTurn.findMany", [turn("only-turn")]);
  const overview = await getAdminOverview();
  const view = ui.render(ui.h("div", null,
    ui.h(AdminRecentActivityTable, { turns: overview.recentTurns }),
    ui.h(AdminBackgroundJobsTable, { jobs: [job("only-job")] }),
  ));
  assert.ok(view.getByText("Question only-turn"));
  assert.ok(view.getByText("only-job"));
  assert.ok(!view.queryByRole("navigation"));
});
