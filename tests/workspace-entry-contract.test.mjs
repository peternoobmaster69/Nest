import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("workspace entry verifies access before switching and blocks external redirects", async () => {
  const entry = await source("app/entry/route.ts");
  const links = await source("lib/workspace-entry.ts");

  assert.match(entry, /await requireWorkspaceAccess\(workspaceId\)/);
  assert.match(entry, /setActiveWorkspaceCookie\(response, workspaceId\)/);
  assert.ok(
    entry.indexOf("await requireWorkspaceAccess(workspaceId)") < entry.indexOf("setActiveWorkspaceCookie(response, workspaceId)"),
    "membership must be verified before the active workspace cookie changes",
  );
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
  assert.match(creditTransactions, /searchParams\.get\("cardId"\)/);
  assert.match(creditTransactions, /searchParams\.get\("month"\)/);
  assert.match(creditTransactions, /searchParams\.get\("year"\)/);
  assert.match(creditTransactions, /queryMonth === "all" \|\| queryMonth === "-1"/);
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
  assert.match(home, /takeoverRequired=\{session\?\.takeoverRequired\}/);
  assert.match(home, /href="\/login"/);
  assert.match(config, /source: "\/login", destination: "\/\?login=1", permanent: false/);
  assert.match(auth, /signIn: "\/login"/);
  assert.doesNotMatch(sidebar, /signOut\(\{ callbackUrl: "\/signin" \}\)/);
  assert.match(sidebar, /signOut\(\{ callbackUrl: "\/" \}\)/);
  assert.match(appShell, /signOut\(\{ callbackUrl: "\/" \}\)/);
});
