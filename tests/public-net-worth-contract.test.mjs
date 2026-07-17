import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("public net-worth API returns total and liquid amounts", async () => {
  const [route, payload] = await Promise.all([
    source("app/api/public/net-worth/[token]/route.ts"),
    source("lib/net-worth.ts"),
  ]);

  assert.match(route, /publicNetWorthEnabled:\s*true/);
  assert.match(route, /publicNetWorthToken:\s*token/);
  assert.match(payload, /isLiquid:\s*true/);
  assert.match(payload, /account\.isLiquid \? \(account\.entries\[0\]\?\.currentValueCents \?\? 0\) : 0/);
  assert.match(payload, /amount:\s*centsToAmount\(savingsCents \+ investmentCents\)/);
  assert.match(payload, /liquidAmt:\s*centsToAmount\(savingsCents \+ liquidInvestmentCents\)/);
});
