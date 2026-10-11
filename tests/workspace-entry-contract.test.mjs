import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("workspace entry verifies access before selecting a canonical scoped URL", async () => {
  const entry = await source("app/entry/route.ts");
  const links = await source("lib/workspace-entry.ts");

  assert.match(entry, /requireWorkspaceAccess\(workspaceId\)/);
  assert.match(entry, /buildWorkspacePath\(selectedWorkspaceId, destination\)/);
  assert.doesNotMatch(entry, /setActiveWorkspaceCookie|activeWorkspaceId/);
  assert.match(entry, /callbackUrl/);
  assert.match(links, /value\.startsWith\("\/\/"\)/);
  assert.match(links, /parsed\.origin !== base\.origin/);
});

test("workspace-scoped notifications and emails route to the exact card statement", async () => {
  const emailReminders = await source("lib/credit-card-payment-reminders.ts");
  const inAppNotifications = await source("lib/in-app-notifications.ts");
  const invitations = await source("app/api/collaborators/invite/route.ts");
  const notificationBell = await source("components/notification-bell.tsx");
  const creditTransactions = await source("components/credit-transactions-page.tsx");
  const links = await source("lib/workspace-entry.ts");

  assert.match(links, /cardId:\s*cardId\.trim\(\)[\s\S]*?month:\s*String\(statementMonth\)[\s\S]*?year:\s*String\(statementYear\)/);
  assert.match(emailReminders, /buildCreditCardStatementPath\([\s\S]*?cardId: row\.cardId[\s\S]*?statementMonth: row\.statementMonth[\s\S]*?statementYear: row\.statementYear/);
  assert.match(emailReminders, /`\$\{rows\[0\]\.workspaceName\} workspace`/);
  assert.match(emailReminders, /This is a reminder that \$\{workspaceLabel\} has credit card payments/);
  assert.match(inAppNotifications, /buildCreditCardStatementPath\([\s\S]*?cardId: row\.cardId[\s\S]*?statementMonth: row\.statementMonth[\s\S]*?statementYear: row\.statementYear/);
  assert.match(inAppNotifications, /href,/);
  assert.match(invitations, /href: `\/invitations\/\$\{token\}`/);
  assert.match(notificationBell, /href=\{notification\.href\}[\s\S]*?prefetch=\{false\}/);
  assert.doesNotMatch(notificationBell, /buildWorkspacePath\(workspaceId, notification\.href\)/);
  assert.match(creditTransactions, /searchParams\.get\("cardId"\)/);
  assert.match(creditTransactions, /searchParams\.get\("month"\)/);
  assert.match(creditTransactions, /searchParams\.get\("year"\)/);
  const creditView = await source("lib/credit-transaction-view.ts");
  assert.match(creditView, /queryMonth === "all" \|\| queryMonth === "-1"/);
  assert.match(creditTransactions, /parseCreditMonthFilter\(queryMonth, savedMonth\)/);
  assert.match(creditTransactions, /if \(month !== undefined\) setSelectedMonth\(month\)/);
  assert.match(creditTransactions, /setSelectedMonth\(-1\)/);
});

test("sign-in preserves the workspace entry callback", async () => {
  const page = await source("app/signin/page.tsx");
  const panel = await source("components/signin-panel.tsx");
  const home = await source("app/page.tsx");
  const config = await source("next.config.ts");
  const auth = await source("lib/auth.ts");
  const sidebar = await source("components/app-sidebar.tsx");
  const appShell = await source("components/app-shell.tsx");

  assert.match(page, /normalizeInternalAppPath\(params\.callbackUrl\)/);
  assert.match(page, /redirect\(callbackUrl\)/);
  assert.match(panel, /signIn\("passkey", \{ loginToken: verified\.loginToken, redirect: false, callbackUrl \}\)/);
  assert.match(panel, /signIn\(provider\.id, \{ callbackUrl \}\)/);
  assert.match(home, /LandingSignInDialog[\s\S]*?callbackUrl=\{callbackUrl\}/);
  assert.match(home, /sessionLimitRequired=\{session\?\.sessionLimitRequired\}/);
  assert.match(home, /href="\/login"/);
  assert.match(config, /source: "\/login", destination: "\/\?login=1", permanent: false/);
  assert.match(auth, /signIn: "\/login"/);
  assert.doesNotMatch(sidebar, /signOut\(\{ callbackUrl: "\/signin" \}\)/);
  assert.match(sidebar, /signOut\(\{ callbackUrl: "\/" \}\)/);
  assert.match(appShell, /signOut\(\{ callbackUrl: "\/" \}\)/);
});

test("workspace URLs are tab-scoped and API requests carry the URL workspace", async () => {
  const routeLayout = await source("app/w/[workspaceId]/layout.tsx");
  const routePage = await source("app/w/[workspaceId]/[[...path]]/page.tsx");
  const client = await source("lib/workspace-client.ts");
  const auth = await source("lib/workspace-auth.ts");
  const context = await source("app/api/context/route.ts");
  const proxy = await source("proxy.ts");

  assert.match(routeLayout, /requireWorkspaceAccess\(workspaceId\)/);
  assert.match(routeLayout, /WorkspaceProvider workspaceId=\{workspaceId\}/);
  assert.match(routePage, /case "transactions"[\s\S]*?<TransactionsRoute/);
  assert.match(client, /getWorkspaceIdFromPathname\(window\.location\.pathname\)/);
  assert.match(client, /headers\.set\(WORKSPACE_ID_HEADER, workspaceId\)/);
  assert.match(auth, /const effectiveWorkspaceId = requestedWorkspaceId \|\| requestWorkspaceId/);
  assert.match(context, /requestedWorkspaceId \|\| cookieWorkspaceId \|\| userLookup\.activeWorkspaceId/);
  assert.match(proxy, /requestHeaders\.set\(WORKSPACE_ID_HEADER, workspaceId\)/);
});

test("explicit workspace switches stay local to the tab URL", async () => {
  const switchRoute = await source("app/api/workspaces/switch/route.ts");
  const mobileShell = await source("components/app-shell.tsx");
  const auth = await source("lib/workspace-auth.ts");
  const bootstrap = await source("lib/workspace-bootstrap.ts");

  assert.match(switchRoute, /await requireSessionUserId\(\)/);
  assert.match(switchRoute, /await requireWorkspaceAccess\(parsed\.data\.workspaceId\)/);
  assert.doesNotMatch(switchRoute, /prisma\.user\.update|setActiveWorkspaceCookie/);

  assert.match(mobileShell, /const switchMobileWorkspace = async/);
  assert.match(mobileShell, /workspaceFetch\("\/api\/workspaces\/switch"[\s\S]*?router\.push\(buildWorkspacePath/);
  assert.match(mobileShell, /Switch workspace in this tab/);

  assert.ok(
    auth.indexOf("const cookieWorkspaceId") < auth.indexOf("if (user.activeWorkspaceId)"),
    "unscoped launches should prefer this browser's fallback over account-wide state",
  );
  assert.match(bootstrap, /storedUser\?\.activeWorkspaceId[\s\S]*?activeMembership/);
  assert.match(bootstrap, /if \(activeMembership\) \{[\s\S]*?return activeMembership\.workspace/);
});
