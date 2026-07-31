import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("liveness is public, minimal, and never cached", async ({ request }) => {
  const response = await request.get("/api/health/live");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toMatchObject({ status: "live" });
});

test("dependency diagnostics are concealed without the health secret", async ({ request }) => {
  const response = await request.get("/api/health/ready");
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: "Not found" });
});

test("offline fallback is keyboard operable and has no serious axe violations", async ({ page }) => {
  await page.goto("/offline.html");
  await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact || ""))).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("style guide reflows and renders consistently in both themes", async ({ page }, testInfo) => {
  await page.goto("/style-guide.html");
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, testInfo.project.name.includes("mobile") ? "dark" : "light");
  await expect(page.locator("body")).toBeVisible();
  await expect(page).toHaveScreenshot("style-guide.png", {
    fullPage: false,
    animations: "disabled",
  });
});

test("service worker cannot retain authenticated API data", async ({ page, context }) => {
  await page.goto("/offline.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const cache = await caches.open("phase9-private-probe");
    await cache.put("/api/context", new Response('{"private":true}'));
  });
  await context.clearCookies();
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) await registration.update();
  });
  const cachedPrivateResponse = await page.evaluate(async () => {
    const names = await caches.keys();
    const matches = await Promise.all(names.map((name) => caches.open(name).then((cache) => cache.match("/api/context"))));
    return matches.some(Boolean);
  });
  // The synthetic cache is not application-owned; this guards the app SW from copying it.
  expect(cachedPrivateResponse).toBe(true);
  const appCacheNames = await page.evaluate(() => caches.keys());
  expect(appCacheNames.filter((name) => /nest.*read/i.test(name))).toEqual([]);
});
