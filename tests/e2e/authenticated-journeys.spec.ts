import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./session";

async function enterWorkspace(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/w\/[^/?#]+$/, { timeout: 30_000 });
  const consent = page.getByRole("dialog", { name: "Your privacy choices" });
  await consent.getByRole("button", { name: "Essential only" }).click();
  await expect(consent).toBeHidden();
}

async function openNavigation(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "Open More menu" }).click();
    return page.getByRole("dialog", { name: "More", exact: true });
  }
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await trigger.isVisible()) await trigger.click();
  return page.getByLabel("Primary navigation");
}

test("session enters a workspace and core finance routes remain tenant scoped", async ({ page }, testInfo) => {
  await enterWorkspace(page);
  const navigation = await openNavigation(page, testInfo.project.name.includes("mobile"));
  await navigation.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/transactions/);
  await expect(page.getByRole("heading", { name: /transactions/i }).first()).toBeVisible();

  const context = await page.request.get("/api/context");
  expect(context.status()).toBe(200);
  expect(context.headers()["cache-control"]).toContain("private");
  expect(context.headers()["x-request-id"]).toBeTruthy();
});

test("workspace switching updates both URL scope and server context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop workspace switch is covered here; mobile navigation has a separate journey.");
  await enterWorkspace(page);
  const navigation = await openNavigation(page, false);
  await navigation.getByRole("button", { name: /Nest Owner/i }).click();
  await navigation.getByRole("button", { name: /E2E Secondary/i }).click();
  await expect(page).toHaveURL(/\/w\/[^/?#]+$/);
  await expect(page.getByText("E2E Secondary", { exact: true }).first()).toBeVisible();
});

test("mobile navigation exposes core destinations and remains accessible", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only journey");
  await enterWorkspace(page);
  const navigation = await openNavigation(page, true);
  await expect(navigation.getByRole("link", { name: "Transactions", exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
});

test("logout removes the authenticated session and private API cache entries", async ({ page }, testInfo) => {
  await enterWorkspace(page);
  await page.evaluate(async () => {
    const cache = await caches.open("nest-e2e-read");
    await cache.put("/api/context", new Response('{"private":true}'));
  });
  const mobile = testInfo.project.name.includes("mobile");
  const navigation = await openNavigation(page, mobile);
  if (!mobile) await navigation.getByRole("button", { name: /Nest Owner/i }).click();
  await navigation.getByRole("button", { name: /^log out$/i }).click();
  await page.getByRole("dialog", { name: "Log out of Nest?" }).getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const response = await page.request.get("/api/context");
  expect(response.status()).toBe(401);
  const privateCachePresent = await page.evaluate(async () => {
    const names = await caches.keys();
    const values = await Promise.all(names.map((name) => caches.open(name).then((cache) => cache.match("/api/context"))));
    return values.some(Boolean);
  });
  expect(privateCachePresent).toBe(false);
});
