import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy mode is applied before paint and toggled from the shell", () => {
  assert.match(read("public/theme-init.js"), /nest-privacy-mode[\s\S]*dataset\.privacy = "on"/);
  assert.match(read("components/app-shell.tsx"), /<PrivacyToggle \/>/);
  const toggle = read("components/privacy-toggle.tsx");
  assert.match(toggle, /aria-pressed=\{hidden\}/);
  assert.match(toggle, /<Button/);
  assert.match(read("app/globals.css"), /privacy-mode\.css/);
});

test("money on financial pages formats through privacy-aware helpers", () => {
  for (const page of [
    "components/dashboard-shell.tsx",
    "components/transactions-page.tsx",
    "components/credit-transactions-page.tsx",
    "components/investments-page.tsx",
    "components/budget-plan-page.tsx",
    "components/receivables-page.tsx",
    "components/rewards-page.tsx",
    "components/settings-page.tsx",
  ]) {
    const source = read(page);
    assert.match(source, /useMoneyFormat\(/, page);
    assert.doesNotMatch(source, /import \{[^}]*\bformatMoney\b[^}]*\} from "@\/lib\/currency"/, page);
  }
  assert.match(read("components/cio/cio-format.ts"), /isPrivacyModeOn\(\)\)? (return |\? )MASKED_AMOUNT/);
  assert.match(read("components/transaction-agent-review.tsx"), /isPrivacyModeOn\(\)\)? (return |\? )MASKED_AMOUNT/);
});

test("masking hides amounts only while privacy mode is on", async () => {
  const { maskAmount, MASKED_AMOUNT } = await import("../lib/privacy-mode.ts");
  assert.equal(maskAmount("SGD 1,234.00", false), "SGD 1,234.00");
  assert.equal(maskAmount("SGD 1,234.00", true), MASKED_AMOUNT);
});
