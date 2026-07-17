import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("public cards-due API is token gated and exposes only the requested card fields", async () => {
  const [route, payload, settings] = await Promise.all([
    source("app/api/public/cards-due/[token]/route.ts"),
    source("lib/public-card-dues.ts"),
    source("components/settings-page.tsx"),
  ]);

  assert.match(route, /publicNetWorthEnabled:\s*true/);
  assert.match(route, /publicNetWorthToken:\s*token/);
  assert.match(route, /token\.length < 24/);
  assert.match(route, /Cache-Control.*public, max-age=60, stale-while-revalidate=300/s);
  assert.match(payload, /amountCents:\s*\{ gt: 0 \}[\s\S]*paymentDueDate:\s*\{ not: null \}/);
  assert.match(payload, /const DUE_WINDOW_DAYS = 14/);
  assert.match(payload, /DUE_WINDOW_DAYS \+ 1/);
  assert.match(payload, /amountCents <= 0/);
  assert.match(payload, /isActive:\s*true/);
  assert.match(payload, /\.map\(\(\{ bank, last4, amount, dueDate \}\) => \(\{ bank, last4, amount, dueDate \}\)\)/);
  assert.match(settings, /\/api\/public\/cards-due\/\$\{publicNetWorthToken\}/);
});
