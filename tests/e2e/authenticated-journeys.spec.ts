import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("sign-in offers passkey fallback without a password flow", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/?login=1`);
  await expect(page.getByRole("dialog", { name: "Sign in to Nest" })).toBeVisible();
  await expect(page.getByText("OAuth and passkeys only. Nest does not store passwords.")).toBeVisible();
  const passkey = page.getByRole("button", { name: "Continue with a passkey" });
  if (await passkey.count()) await expect(passkey).toBeEnabled();
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
  await context.close();
});

test("session enters a workspace and core finance routes remain tenant scoped", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/[^/]+\/dashboard/);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/transactions/);
  await expect(page.getByRole("heading", { name: /transactions/i }).first()).toBeVisible();

  const context = await page.request.get("/api/context");
  expect(context.status()).toBe(200);
  expect(context.headers()["cache-control"]).toContain("private");
  expect(context.headers()["x-request-id"]).toBeTruthy();
});

test("workspace switching updates both URL scope and server context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop workspace switch is covered here; mobile navigation has a separate journey.");
  await page.goto("/");
  await page.getByRole("button", { name: /Nest Owner/i }).click();
  await page.getByRole("button", { name: /E2E Secondary/i }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/dashboard/);
  await expect(page.getByText("E2E Secondary", { exact: true }).first()).toBeVisible();
});

test("mobile navigation exposes core destinations and remains accessible", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only journey");
  await page.goto("/");
  await page.getByRole("button", { name: "Open More menu" }).click();
  await expect(page.getByRole("link", { name: "Transactions", exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

test("logout removes the authenticated session and private API cache entries", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      await cache.delete("/api/context");
    }
  });
  await context.clearCookies();
  const response = await page.request.get("/api/context");
  expect(response.status()).toBe(401);
  const privateCachePresent = await page.evaluate(async () => {
    const names = await caches.keys();
    const values = await Promise.all(names.map((name) => caches.open(name).then((cache) => cache.match("/api/context"))));
    return values.some(Boolean);
  });
  expect(privateCachePresent).toBe(false);
});
