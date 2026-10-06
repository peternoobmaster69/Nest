import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { APP_ICON_VARIANTS, DEFAULT_APP_ICON, appIconAssets, parseAppIcon } from "../lib/app-icons.ts";

const root = process.cwd();
const source = (file) => readFile(path.join(root, file), "utf8");

test("unknown or missing icon choices fall back to the default", () => {
  assert.equal(parseAppIcon(undefined), DEFAULT_APP_ICON);
  assert.equal(parseAppIcon("../../etc/passwd"), DEFAULT_APP_ICON);
  assert.equal(parseAppIcon("midnight"), "midnight");
});

test("default variant keeps the original install icon paths", () => {
  const assets = appIconAssets(DEFAULT_APP_ICON);
  assert.equal(assets.icon192, "/icons/icon-192.png");
  assert.equal(assets.appleTouch, "/icons/apple-touch-icon.png");
  assert.equal(assets.favicon, "/favicon.svg");
});

test("every selectable variant ships rendered icon assets", async () => {
  for (const variant of APP_ICON_VARIANTS) {
    const assets = appIconAssets(variant.id);
    for (const asset of [assets.icon192, assets.icon512, assets.maskable192, assets.maskable512, assets.appleTouch, assets.favicon]) {
      const file = await stat(path.join(root, "public", asset));
      assert.ok(file.size > 500, `${variant.id}: ${asset} should be a rendered asset`);
    }
  }
});

test("generator and shared config list the same variants", async () => {
  const generator = await source("scripts/generate-app-icons.mjs");
  for (const variant of APP_ICON_VARIANTS) {
    assert.match(generator, new RegExp(`id: "${variant.id}", tile: \\["${variant.tile[0]}", "${variant.tile[1]}"\\]`));
  }
});

test("manifest and layout follow the per-device icon cookie with a stable app id", async () => {
  const [manifest, layout] = await Promise.all([source("app/manifest.ts"), source("app/layout.tsx")]);
  assert.match(manifest, /cookies\(\)\)\.get\(APP_ICON_COOKIE\)/);
  assert.match(manifest, /id:\s*"\/"/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /cookies\(\)\)\.get\(APP_ICON_COOKIE\)/);
});
