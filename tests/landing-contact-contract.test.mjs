import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ContactRequestSchema } from "../lib/domains/contact/contracts.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

const valid = { name: "Ada", email: "ada@example.com", topic: "hosting", message: "How do I self-host Nest?" };

test("contact schema accepts a real message and rejects bad input", () => {
  assert.equal(ContactRequestSchema.safeParse(valid).success, true);
  assert.equal(ContactRequestSchema.safeParse({ ...valid, email: "not-an-email" }).success, false);
  assert.equal(ContactRequestSchema.safeParse({ ...valid, message: "hi" }).success, false);
  assert.equal(ContactRequestSchema.safeParse({ ...valid, topic: "sales" }).success, false);
  assert.equal(ContactRequestSchema.safeParse({ ...valid, message: "x".repeat(4001) }).success, false);
  // A filled honeypot still parses: the route discards it without telling the bot.
  assert.equal(ContactRequestSchema.safeParse({ ...valid, website: "spam.example" }).success, true);
});

test("contact route is same-origin, rate limited, bot filtered, and size capped", async () => {
  const route = await source("app/api/public/contact/route.ts");
  assert.match(route, /mutation:\s*true/);
  assert.match(route, /scope: "public-contact-burst"/);
  assert.match(route, /scope: "public-contact-daily"/);
  assert.match(route, /scope: "public-contact-sender"/);
  assert.match(route, /input\.website/);
  assert.match(route, /MIN_FILL_MS/);
  assert.match(route, /parseJsonBody\(request, ContactRequestSchema, 16 \* 1024\)/);
});

test("contact email goes to ADMIN with the visitor as reply-to and escapes user content", async () => {
  const email = await source("lib/contact-email.ts");
  assert.match(email, /process\.env\.ADMIN/);
  assert.match(email, /replyTo: \[\{ address: email/);
  assert.match(email, /escapeHtml\(input\.message\)/);
  assert.match(email, /replace\(\/\[\\r\\n\]\+\/g/);
});

test("landing page exposes the contact popup from nav, body, and footer", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /<LandingContact \/>/);
  assert.equal((page.match(/href="#contact"/g) ?? []).length, 3);
});
