import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("sign-in offers passkey fallback without a password flow", async ({ page }) => {
  const [providers] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/providers", { timeout: 30_000 }),
    page.goto("/?login=1"),
  ]);
  expect(providers.status()).toBe(200);
  await expect(page.getByRole("dialog", { name: "Sign in to Nest" })).toBeVisible();
  await expect(page.getByText("OAuth and passkeys only. Nest does not store passwords.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with a passkey" })).toBeEnabled();
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
});

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

test("offline navigation loads every fallback script through the worker under the production CSP", async ({ page, context }) => {
  const scriptErrors: string[] = [];
  const cachedScripts = new Set<string>();
  page.on("pageerror", (error) => scriptErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) scriptErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.fromServiceWorker()) cachedScripts.add(new URL(response.url()).pathname);
  });
  await page.goto("/offline.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto("/w/offline-probe/transactions", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("Offline · Nest");
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("{{");
  for (const asset of ["/static-page-messages.js", "/static-page-copy.js", "/offline.js"]) {
    expect(cachedScripts.has(asset), `${asset} must be available offline`).toBe(true);
  }
  expect(scriptErrors).toEqual([]);
});

test("style guide reflows and renders consistently in both themes", async ({ page }, testInfo) => {
  await page.goto("/style-guide.html");
  const theme = testInfo.project.name.includes("mobile") ? "dark" : "light";
  await page.getByRole("button", { name: theme === "dark" ? "🌙 Dark" : "☀️ Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.mouse.move(0, 0);
  await expect(page.locator("body")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
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
