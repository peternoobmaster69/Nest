import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  getAuthRequestMetadata,
  getTrustedRequestMetadata,
  withAuthRequestMetadata,
} from "../lib/auth-request-metadata.ts";
import { describeClientDevice, describeSessionDevice } from "../lib/session-device.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("Vercel login metadata uses platform IP and ISO country headers", () => {
  const request = new Request("https://nest.example.com/api/auth/callback/google", {
    headers: {
      "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.2",
      "x-vercel-ip-country": "sg",
      "cf-connecting-ip": "198.51.100.4",
      "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    },
  });

  assert.deepEqual(getTrustedRequestMetadata(request, { VERCEL: "1" }), {
    ipAddress: "203.0.113.9",
    countryCode: "SG",
    userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  });
});

test("untrusted forwarding headers are ignored", () => {
  const request = new Request("https://nest.example.com/api/auth/callback/google", {
    headers: {
      "x-forwarded-for": "203.0.113.9",
      "x-vercel-ip-country": "SG",
      "cf-ipcountry": "SG",
    },
  });

  assert.deepEqual(getTrustedRequestMetadata(request, {}), {
    ipAddress: null,
    countryCode: null,
    userAgent: null,
  });
});

test("trusted proxy metadata validates IPs and supports a configured country header", () => {
  const request = new Request("https://nest.example.com/api/auth/callback/google", {
    headers: {
      "x-real-ip": "[2001:db8::1]:443",
      "x-nest-country": "nz",
    },
  });

  assert.deepEqual(
    getTrustedRequestMetadata(request, {
      TRUST_PROXY_HEADERS: "true",
      TRUSTED_COUNTRY_HEADER: "x-nest-country",
    }),
    { ipAddress: "2001:db8::1", countryCode: "NZ", userAgent: null },
  );

  assert.deepEqual(
    getTrustedRequestMetadata(
      new Request("https://nest.example.com", {
        headers: { "x-real-ip": "not-an-ip", "cf-ipcountry": "T1" },
      }),
      { TRUST_PROXY_HEADERS: "true" },
    ),
    { ipAddress: null, countryCode: null, userAgent: null },
  );
});

test("auth metadata remains request-scoped across asynchronous callbacks", async () => {
  const request = new Request("https://nest.example.com/api/auth/callback/google", {
    headers: {
      "x-vercel-forwarded-for": "198.51.100.20",
      "x-vercel-ip-country": "AU",
    },
  });
  const originalVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    await withAuthRequestMetadata(request, async () => {
      await Promise.resolve();
      assert.deepEqual(getAuthRequestMetadata(), {
        ipAddress: "198.51.100.20",
        countryCode: "AU",
        userAgent: null,
      });
    });
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});

test("successful sign-ins persist bounded, user-visible active-session metadata", async () => {
  const [schema, migration, activeMigration, auth, authRoute, sessionsRoute, retention, settings, privacy] =
    await Promise.all([
      source("prisma/schema.prisma"),
      source("prisma/migrations/20260722000000_login_session_audit/migration.sql"),
      source("prisma/migrations/20260722120000_multi_device_sessions/migration.sql"),
      source("lib/auth.ts"),
      source("app/api/auth/[...nextauth]/route.ts"),
      source("app/api/auth/sessions/route.ts"),
      source("lib/data-retention.ts"),
      source("components/settings-app-access.tsx"),
      source("app/privacy-policy/page.tsx"),
    ]);

  assert.match(schema, /model LoginSession[\s\S]*deviceName\s+String[\s\S]*ipAddress\s+String\?[\s\S]*status\s+String[\s\S]*lastSeenAt\s+DateTime[\s\S]*expiresAt\s+DateTime/);
  assert.match(schema, /@@index\(\[userId, signedInAt\]\)/);
  assert.match(schema, /@@index\(\[userId, status, expiresAt\]\)/);
  assert.match(migration, /CREATE TABLE \[dbo\]\.\[LoginSession\]/);
  assert.match(migration, /FOREIGN KEY \(\[userId\]\).*ON DELETE CASCADE/);
  assert.match(activeMigration, /CHECK \(\[status\] IN \(''ACTIVE'', ''PENDING'', ''REVOKED''\)\)/);
  assert.match(activeMigration, /LoginSession_expiresAt_df[\s\S]*DATEADD\(DAY, 30, GETDATE\(\)\)/);
  assert.doesNotMatch(activeMigration, /DROP COLUMN \[activeSessionId\]/);
  assert.match(authRoute, /withAuthRequestMetadata\(request/);
  assert.match(auth, /transaction\.loginSession\.create/);
  assert.match(auth, /provider: login\?\.provider \?\? null/);
  assert.match(auth, /activeSessionCount < MAX_ACTIVE_SESSIONS \? "ACTIVE" : "PENDING"/);
  assert.match(auth, /describeSessionDevice\(requestMetadata\.userAgent\)/);
  assert.match(sessionsRoute, /export async function GET/);
  assert.match(sessionsRoute, /status: "ACTIVE"[\s\S]*orderBy: \{ lastSeenAt: "desc" \}[\s\S]*take: MAX_ACTIVE_SESSIONS/);
  assert.match(sessionsRoute, /current: session\.sessionId === token\?\.sessionId/);
  assert.match(sessionsRoute, /body\.sessionId[\s\S]*status: "REVOKED"/);
  assert.match(retention, /LOGIN_SESSION_RETENTION_DAYS/);
  assert.match(retention, /DELETE TOP \(\$\{size\}\) FROM \[dbo\]\.\[LoginSession\]/);
  assert.match(settings, /Active sessions/);
  assert.match(settings, /up to five devices/);
  assert.match(settings, /session\.deviceName/);
  assert.match(settings, /sessionId: session\.sessionId/);
  assert.match(privacy, /device\/browser type,[\s\S]*IP address,[\s\S]*country code associated with account sign-ins/);
});

test("Apple device labels avoid treating ambiguous mobile Safari as an iPad", () => {
  assert.equal(
    describeSessionDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"),
    "iPhone · Safari",
  );
  assert.equal(
    describeSessionDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"),
    "iPad · Safari",
  );
  assert.equal(
    describeSessionDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"),
    "Apple mobile device · Safari",
  );
  const desktopModeUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  assert.equal(describeClientDevice(desktopModeUserAgent, 5, 430, 932), "iPhone · Safari");
  assert.equal(describeClientDevice(desktopModeUserAgent, 5, 820, 1180), "iPad · Safari");
});
