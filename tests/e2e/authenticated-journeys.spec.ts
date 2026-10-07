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
    return page.getByRole("navigation", { name: "Primary mobile navigation" });
  }
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await trigger.isVisible()) await trigger.click();
  return page.getByLabel("Primary navigation");
}

async function openAccountOptions(page: Page, mobile: boolean) {
  const navigation = await openNavigation(page, mobile);
  if (mobile) {
    await navigation.getByRole("button", { name: "Open More menu" }).click();
    const more = page.getByRole("dialog", { name: "More", exact: true });
    await expect(more).toBeVisible();
    return more;
  }
  await navigation.getByRole("button", { name: /Nest Owner/i }).click();
  return navigation.getByRole("region", { name: "Account options" });
}

test("session enters a workspace and core finance routes remain tenant scoped", async ({ page }, testInfo) => {
  await enterWorkspace(page);
  const workspacePath = new URL(page.url()).pathname;
  const navigation = await openNavigation(page, testInfo.project.name.includes("mobile"));
  await navigation.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(new URL(`${workspacePath}/transactions`, page.url()).href, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /transactions/i }).first()).toBeVisible();

  const context = await page.request.get("/api/context");
  expect(context.status()).toBe(200);
  expect(context.headers()["cache-control"]).toContain("no-store");
  expect(context.headers()["x-request-id"]).toBeTruthy();
  expect((await context.json()).workspaceId).toBe(workspacePath.split("/")[2]);
});

test("workspace switching updates the tab URL and its server context", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Desktop workspace switch is covered here; mobile navigation has a separate journey.");
  await enterWorkspace(page);
  const beforeResponse = await page.request.get("/api/context");
  expect(beforeResponse.ok()).toBe(true);
  const before = await beforeResponse.json();
  const target = before.workspaces.find((workspace: { id: string; name: string }) => workspace.id !== before.workspaceId);
  expect(target).toBeTruthy();
  const options = await openAccountOptions(page, false);
  const [afterResponse] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/context" &&
      response.request().headers()["x-workspace-id"] === target.id,
    ),
    options.getByRole("button", { name: target.name }).click(),
  ]);
  await expect(page).toHaveURL(new URL(`/w/${target.id}`, page.url()).href, { timeout: 30_000 });
  expect(afterResponse.ok()).toBe(true);
  expect(await afterResponse.json()).toMatchObject({ workspaceId: target.id, workspaceName: target.name });
  const fallback = await page.request.get("/api/context");
  expect(fallback.ok()).toBe(true);
  expect((await fallback.json()).workspaceId).toBe(before.workspaceId);
});

test("mobile navigation exposes core destinations and remains accessible", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only journey");
  await enterWorkspace(page);
  const navigation = await openNavigation(page, true);
  await expect(navigation.getByRole("link", { name: "Transactions", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Cards", exact: true })).toBeVisible();
  const more = await openAccountOptions(page, true);
  await expect(more.getByRole("link", { name: /^Rewards/ })).toBeVisible();
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
  const options = await openAccountOptions(page, mobile);
  await options.getByRole("button", { name: /^log out/i }).click();
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
