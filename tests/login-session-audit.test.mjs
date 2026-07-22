import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  getAuthRequestMetadata,
  getTrustedRequestMetadata,
  withAuthRequestMetadata,
} from "../lib/auth-request-metadata.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("Vercel login metadata uses platform IP and ISO country headers", () => {
  const request = new Request("https://nest.example.com/api/auth/callback/google", {
    headers: {
      "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.2",
      "x-vercel-ip-country": "sg",
      "cf-connecting-ip": "198.51.100.4",
    },
  });

  assert.deepEqual(getTrustedRequestMetadata(request, { VERCEL: "1" }), {
    ipAddress: "203.0.113.9",
    countryCode: "SG",
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
    { ipAddress: "2001:db8::1", countryCode: "NZ" },
  );

  assert.deepEqual(
    getTrustedRequestMetadata(
      new Request("https://nest.example.com", {
        headers: { "x-real-ip": "not-an-ip", "cf-ipcountry": "T1" },
      }),
      { TRUST_PROXY_HEADERS: "true" },
    ),
    { ipAddress: null, countryCode: null },
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
      });
    });
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});

test("successful sign-ins persist bounded, user-visible session metadata", async () => {
  const [schema, migration, auth, authRoute, sessionsRoute, retention, settings, privacy] =
    await Promise.all([
      source("prisma/schema.prisma"),
      source("prisma/migrations/20260722000000_login_session_audit/migration.sql"),
      source("lib/auth.ts"),
      source("app/api/auth/[...nextauth]/route.ts"),
      source("app/api/auth/sessions/route.ts"),
      source("lib/data-retention.ts"),
      source("components/settings-app-access.tsx"),
      source("app/privacy-policy/page.tsx"),
    ]);

  assert.match(schema, /model LoginSession[\s\S]*ipAddress\s+String\?[\s\S]*countryCode\s+String\?/);
  assert.match(schema, /@@index\(\[userId, signedInAt\]\)/);
  assert.match(migration, /CREATE TABLE \[dbo\]\.\[LoginSession\]/);
  assert.match(migration, /FOREIGN KEY \(\[userId\]\).*ON DELETE CASCADE/);
  assert.match(authRoute, /withAuthRequestMetadata\(request/);
  assert.match(auth, /prisma\.loginSession\.create/);
  assert.match(auth, /provider: account\?\.provider \?\? null/);
  assert.match(sessionsRoute, /export async function GET/);
  assert.match(sessionsRoute, /orderBy: \{ signedInAt: "desc" \}[\s\S]*take: 5/);
  assert.match(sessionsRoute, /active: session\.sessionId === user\?\.activeSessionId/);
  assert.match(retention, /LOGIN_SESSION_RETENTION_DAYS/);
  assert.match(retention, /DELETE TOP \(\$\{size\}\) FROM \[dbo\]\.\[LoginSession\]/);
  assert.match(settings, /Recent sign-ins/);
  assert.match(settings, /five most recent sign-ins/);
  assert.match(privacy, /IP address and[\s\S]*country code associated with account sign-ins/);
});
