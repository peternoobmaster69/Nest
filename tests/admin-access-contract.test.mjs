import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("admin route is protected by a fail-closed server email check", async () => {
  const [auth, page] = await Promise.all([
    read("lib/admin-auth.ts"),
    read("app/admin/page.tsx"),
  ]);

  assert.match(auth, /process\.env\.ADMIN/);
  assert.match(auth, /configuredAdmin && candidate && configuredAdmin === candidate/);
  assert.match(auth, /notFound\(\)/);
  assert.doesNotMatch(auth, /NEXT_PUBLIC/);
  assert.match(page, /await requireAdminPage\(\)/);
});

test("admin navigation is driven only by the server-provided access flag", async () => {
  const [context, sidebar, shell] = await Promise.all([
    read("app/api/context/route.ts"),
    read("components/app-sidebar.tsx"),
    read("components/app-shell.tsx"),
  ]);

  assert.match(context, /isAdminEmail\(email\)/);
  assert.match(sidebar, /resolvedContext\?\.isAdmin/);
  assert.match(shell, /contextData\?\.isAdmin/);
  assert.doesNotMatch(sidebar, /process\.env\.ADMIN/);
  assert.doesNotMatch(shell, /process\.env\.ADMIN/);
});

test("admin overview reports secret presence without returning secret values", async () => {
  const overview = await read("lib/admin-overview.ts");

  assert.match(overview, /aiKeyConfigured: Boolean\(process\.env\.AI_WORKLOAD_API_KEY/);
  assert.doesNotMatch(overview, /aiKey:\s*process\.env\.AI_WORKLOAD_API_KEY/);
});

test("admin overview lists users and workspace details", async () => {
  const [overview, page, directories] = await Promise.all([
    read("lib/admin-overview.ts"),
    read("app/admin/page.tsx"),
    read("components/admin-directories.tsx"),
  ]);

  assert.match(overview, /prisma\.user\.findMany/);
  assert.match(overview, /prisma\.workspace\.findMany/);
  assert.match(overview, /memberships:/);
  assert.match(overview, /transactions: true/);
  assert.match(page, /<AdminDirectories users={overview\.users} workspaces={overview\.workspaces}/);
  assert.match(directories, /openDirectory === "users"/);
  assert.match(directories, /openDirectory === "workspaces"/);
  assert.match(directories, /users\.map/);
  assert.match(directories, /workspaces\.map/);
  assert.match(directories, /aria-expanded=/);
  assert.match(directories, />Workspace access</);
  assert.match(directories, />Transactions</);
});

test("admin page exposes aggregate and per-turn token usage", async () => {
  const [overview, page] = await Promise.all([
    read("lib/admin-overview.ts"),
    read("app/admin/page.tsx"),
  ]);

  assert.match(overview, /tokenUsage:/);
  assert.match(overview, /inputTokens: true/);
  assert.match(overview, /totalTokens: true/);
  assert.match(page, /Ask Nest usage and estimated cost/);
  assert.match(page, /Tracked tokens/);
  assert.match(page, />Untracked</);
});

test("admin totals retain archived Ask Nest usage after raw history is purged", async () => {
  const [overview, page] = await Promise.all([
    read("lib/admin-overview.ts"),
    read("app/admin/page.tsx"),
  ]);

  assert.match(overview, /prisma\.askNestUsageDaily\.aggregate/);
  assert.match(overview, /archivedUsageByUser/);
  assert.match(overview, /archivedRecentUsage/);
  assert.match(overview, /sevenDaysAgoDay/);
  assert.match(overview, /askNestHistoryRetentionDays/);
  assert.match(page, /Ask Nest history/);
});

test("admin cost estimates require explicit server-only Azure token rates", async () => {
  const [overview, page, readme] = await Promise.all([
    read("lib/admin-overview.ts"),
    read("app/admin/page.tsx"),
    read("README.md"),
  ]);

  assert.match(overview, /AI_WORKLOAD_INPUT_COST_PER_1M_USD/);
  assert.match(overview, /AI_WORKLOAD_OUTPUT_COST_PER_1M_USD/);
  assert.match(overview, /estimatedCost/);
  assert.doesNotMatch(overview, /NEXT_PUBLIC.*COST/);
  assert.match(page, /estimated cost/);
  assert.match(page, /This is an estimate, not an Azure invoice/);
  assert.match(readme, /AI_WORKLOAD_INPUT_COST_PER_1M_USD/);
});

test("admin page reports whole-database storage without failing when metadata is unavailable", async () => {
  const [overview, page] = await Promise.all([
    read("lib/admin-overview.ts"),
    read("app/admin/page.tsx"),
  ]);

  assert.match(overview, /prisma\.\$queryRaw/);
  assert.match(overview, /sys\.database_files/);
  assert.match(overview, /totalAllocatedMb/);
  assert.match(overview, /catch \{\s*return null;/);
  assert.match(page, /Database storage/);
  assert.match(page, /formatStorage/);
});

test("admin overview reports Ask Nest tool quality and usefulness without exposing diagnostics payloads", async () => {
  const [overview, page] = await Promise.all([
    read("lib/admin-overview.ts"),
    read("app/admin/page.tsx"),
  ]);
  assert.match(overview, /emptyResultRate/);
  assert.match(overview, /helpfulRate/);
  assert.match(overview, /getAskNestSearchGate/);
  assert.doesNotMatch(overview, /diagnosticsJson:\s*turn\.diagnosticsJson/);
  assert.match(page, /Tool quality/);
  assert.match(page, /User feedback/);
  assert.match(page, /Knowledge search/);
});
