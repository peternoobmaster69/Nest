import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("rewards uses a compact desktop and tablet summary rail", async () => {
  const [component, styles] = await Promise.all([
    source("components/rewards-page.tsx"),
    source("app/styles/features.css"),
  ]);

  assert.match(styles, /\.rewards-overview\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 3fr\) minmax\(340px, 2fr\);[\s\S]*?margin-bottom:\s*14px;/);
  assert.match(styles, /\.rewards-overview-card\s*\{[\s\S]*?padding:\s*11px 14px;/);
  assert.match(styles, /\.rewards-total-panel\s*\{[\s\S]*?padding:\s*11px 16px;/);
  assert.match(styles, /\.rewards-tabs \.segmented-btn\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?padding:\s*5px 12px;/);
  assert.match(styles, /\.rewards-item-card\s*\{\s*padding:\s*12px 14px;/);
  assert.match(component, /className="grid-2 rewards-program-grid"/);
  assert.match(component, /className="card rewards-item-card"/);
  assert.match(component, /className="rewards-conversion-list"/);
});

test("rewards retains a stacked overview with compact side-by-side mobile totals", async () => {
  const styles = await source("app/styles/features.css");
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.rewards-overview\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.rewards-total-panel\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);[\s\S]*?padding:\s*9px 10px;/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.rewards-total-value\s*\{\s*font-size:\s*18px;/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.rewards-total-sub\s*\{[\s\S]*?font-size:\s*9px;/);
  assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?\.rewards-tab-action\s*\{[\s\S]*?min-height:\s*44px;/);
});
