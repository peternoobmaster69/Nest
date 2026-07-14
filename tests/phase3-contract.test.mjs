import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("manifest ships standard, Apple, and maskable production icons", async () => {
  const manifest = await source("app/manifest.ts");
  const layout = await source("app/layout.tsx");
  for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
    const file = await stat(path.join(root, "public", "icons", icon));
    assert.ok(file.size > 1000, `${icon} should be a rendered production asset`);
  }
  assert.match(manifest, /purpose:\s*"maskable"/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(layout, /apple-touch-icon\.png/);
});

test("service worker caches only GET resources and never queues financial mutations", async () => {
  const worker = await source("public/sw.js");
  const integration = await source("components/device-integration.tsx");
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /queued:\s*false/);
  assert.doesNotMatch(worker, /addEventListener\(["']sync["']/);
  assert.doesNotMatch(worker, /SAFE_READ_PATHS|\/api\/context|\/api\/dashboard\/summary|\/api\/notifications/);
  assert.match(worker, /key\.endsWith\("-read"\)/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /hostname === "localhost"/);
  assert.match(worker, /networkFirst\(request, STATIC_CACHE\)/);
  assert.match(integration, /This change was not submitted or queued/);
  assert.match(integration, /serviceWorker\.register\("\/sw\.js"\)/);
});

test("passkeys use one-time challenges, replay counters, and NextAuth handoff tickets", async () => {
  const schema = await source("prisma/schema.prisma");
  const auth = await source("lib/auth.ts");
  const passkeys = await source("lib/passkeys.ts");
  const register = await source("app/api/passkeys/register/verify/route.ts");
  const authenticate = await source("app/api/passkeys/authenticate/verify/route.ts");
  const management = await source("app/api/passkeys/route.ts");
  const settings = await source("components/settings-app-access.tsx");
  assert.match(schema, /model PasskeyCredential[\s\S]*?credentialId\s+String\s+@unique[\s\S]*?counter\s+BigInt/);
  assert.match(schema, /model WebAuthnChallenge/);
  assert.match(auth, /CredentialsProvider\([\s\S]*?consumePasskeyLoginTicket/);
  assert.match(passkeys, /LOGIN_TICKET_TTL_MS\s*=\s*60 \* 1000/);
  assert.match(register, /requireUserVerification:\s*true/);
  assert.match(register, /Passkey name must be between 1 and 80 characters/);
  assert.match(authenticate, /newCounter/);
  assert.match(authenticate, /consumeWebAuthnChallenge/);
  assert.match(management, /export async function PATCH/);
  assert.match(management, /data:\s*\{ name \}/);
  assert.match(settings, /suggestedPasskeyName/);
  assert.match(settings, /Peter's iPhone or YubiKey/);
  assert.match(settings, /Rename \$\{passkey\.name/);
  assert.match(settings, /Last used/);
});

test("push notifications are limited to scheduled card-due reminders and invitations", async () => {
  const schema = await source("prisma/schema.prisma");
  const route = await source("app/api/push-subscriptions/route.ts");
  const delivery = await source("lib/web-push.ts");
  const invitations = await source("app/api/collaborators/invite/route.ts");
  const jobs = await source("lib/background-jobs.ts");
  const cardReminders = await source("lib/in-app-notifications.ts");
  const reminderRunner = await source("lib/credit-card-payment-reminders.ts");
  const settings = await source("components/settings-app-access.tsx");
  const notificationBell = await source("components/notification-bell.tsx");
  assert.match(schema, /model PushSubscription/);
  assert.match(route, /Notification|push subscription|publicKey/i);
  assert.doesNotMatch(delivery, /Receivable date reminder|receivable-date:/i);
  assert.match(invitations, /Workspace invitation/);
  assert.doesNotMatch(jobs, /Background task complete|sendPushToUser/);
  assert.match(cardReminders, /sendPushToUser/);
  assert.match(cardReminders, /shouldSendPaymentReminder\(getDaysUntilDue\(row\.paymentDueDate, today\)\)/);
  assert.match(cardReminders, /\[type\] IN \(\$\{CREDIT_CARD_DUE_TYPE\}, \$\{WORKSPACE_INVITATION_TYPE\}\)/);
  assert.doesNotMatch(reminderRunner, /sendReceivableDatePushReminders/);
  assert.match(settings, /scheduled reminders for credit card payments that are due, plus workspace invitations/);
  assert.doesNotMatch(settings, /payment, receivable, invitation, and background-task alerts/);
  assert.match(notificationBell, /Credit card due reminders and workspace invitations will appear here/);
});
