import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

export function overviewFixture(overrides = {}) {
  return {
    asOfDate: "2026-10-10", baseCurrency: "SGD",
    totals: { financialAssetsCents: 100_000, savingsSubAccountCents: 20_000, investableAssetsCents: 80_000, retirementIncludedAssetsCents: 60_000, planningLiabilitiesCents: 0 },
    dataQuality: { warnings: [], completenessBps: 10000, completenessPercentage: 100, latestValuationDate: "2026-10-09", oldestValuationDate: "2026-10-01" },
    annualContributions: { usedExternalAnnualCents: 12_000 },
    retirement: { status: "NOT_READY", missingFields: [], projection: null },
    allocation: { totalCents: 0, assetClasses: [], geographies: [] },
    liquidity: { immediateCents: 10000, liquidCents: 20000, restrictedCents: 30000, lockedCents: 40000, readilyAvailableCents: 30000, essentialMonthlyExpenseCents: 10000, emergencyRunwayMonths: 3 },
    recurringFlows: { externalContributionAnnualCents: 12000, externalWithdrawalAnnualCents: 3000, internalReallocationAnnualCents: 5000, netExternalContributionAnnualCents: 9000 },
    contributionProgress: null, investments: [], policyExceptions: [], evidence: [],
    ...overrides,
  };
}

export function reportFixture(overrides = {}) {
  return {
    id: "report-1", title: "Household strategy", generatedAt: "2026-07-01T10:00:00.000Z", asOfDate: "2026-07-01",
    strategyStatus: "ACTION_REQUIRED", completenessBps: 9500, topRecommendations: [], ...overrides,
  };
}

export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

export async function createCioUiHarness() {
  const ui = await createReactHarness();
  const require = createRequire(import.meta.url);
  const navigation = [];
  const notifications = [];
  const router = { push: (path) => navigation.push(path) };
  mock.module("next/navigation", { namedExports: { useRouter: () => router, usePathname: () => ui.window.location.pathname } });
  mock.module("../components/toast-provider.tsx", { namedExports: { useToast: () => ({ success: (message) => notifications.push(["success", message]), error: (message) => notifications.push(["error", message]) }) } });
  const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
  const { ConfirmDialogProvider } = require("../components/confirm-dialog.tsx");
  const { setPrivacyMode } = require("../lib/privacy-mode.ts");
  const fixtures = new Map();
  const requests = [];
  const unexpected = [];
  let client;
  beforeEach((t) => {
    fixtures.clear();
    requests.length = 0;
    navigation.length = 0;
    notifications.length = 0;
    unexpected.length = 0;
    ui.window.history.replaceState(null, "", "/w/household/cio");
    Object.defineProperty(ui.window, "innerWidth", { value: 1280, configurable: true, writable: true });
    setPrivacyMode(false);
    fixtures.set("GET /api/context", { workspaceId: "household", role: "OWNER", baseCurrency: "SGD", accounts: [] });
    fixtures.set("GET /api/cio/overview", { overview: overviewFixture() });
    fixtures.set("GET /api/cio/policy", { policy: null });
    fixtures.set("GET /api/cio/profile", { profile: null });
    fixtures.set("GET /api/cio/planning-positions", { items: [] });
    fixtures.set("GET /api/cio/recurring-flows", { items: [] });
    fixtures.set("GET /api/investments", []);
    fixtures.set("GET /api/cio/reports", { reports: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost:3100");
      const method = init.method ?? "GET";
      const request = { url, method, body: init.body && JSON.parse(init.body), headers: new Headers(init.headers), cache: init.cache };
      requests.push(request);
      const key = `${method} ${url.pathname}`;
      if (!fixtures.has(key)) {
        unexpected.push(key);
        throw new Error(`Missing request fixture: ${key}`);
      }
      const fixture = fixtures.get(key);
      if (typeof fixture === "function") return fixture(request);
      return fixture instanceof Response ? fixture.clone() : Response.json(fixture);
    });
  });
  afterEach(async () => {
    ui.cleanup();
    client.clear();
    await ui.window.happyDOM.abort();
    assert.deepEqual(unexpected, [], "Every network call must have an explicit fixture");
  });
  after(() => ui.dispose());
  const element = (Component, props) => ui.h(QueryClientProvider, { client }, ui.h(ConfirmDialogProvider, null, ui.h(Component, props)));
  return { ui, require, fixtures, requests, navigation, notifications, setPrivacyMode, client: () => client, element, show: (Component, props) => ui.render(element(Component, props)) };
}
