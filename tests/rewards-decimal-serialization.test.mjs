import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("rewards normalizes Prisma decimals before returning the aggregate response", async () => {
  const route = await source("app/api/rewards/route.ts");

  assert.match(route, /hotelRewards:\s*hotelRewards\.map\([\s\S]*?centsPerPoint:\s*Number\(hotel\.centsPerPoint\)/);
  assert.match(route, /conversions:\s*conversions\.map\([\s\S]*?conversionRate:\s*Number\(conversion\.conversionRate\)/);
});

test("rewards formatting remains defensive against a stale string-valued response", async () => {
  const component = await source("components/rewards-page.tsx");

  assert.match(component, /Number\(hotel\.centsPerPoint\)\.toFixed\(3\)/);
  assert.match(component, /Number\(conv\.conversionRate\)\.toFixed\(3\)/);
  assert.doesNotMatch(component, /hotel\.centsPerPoint\.toFixed|conv\.conversionRate\.toFixed/);
});
