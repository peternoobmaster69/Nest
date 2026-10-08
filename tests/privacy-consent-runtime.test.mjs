import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent } = ui;
const require = createRequire(import.meta.url);
mock.module(require.resolve("@vercel/analytics/next"), { namedExports: { Analytics: () => h("span", { "data-testid": "analytics" }) } });
mock.module(require.resolve("@vercel/speed-insights/next"), { namedExports: { SpeedInsights: () => h("span", { "data-testid": "speed-insights" }) } });
mock.module("../components/web-vitals-reporter.tsx", { namedExports: { WebVitalsReporter: () => h("span", { "data-testid": "web-vitals" }) } });
const { PrivacyConsentProvider, usePrivacyConsent } = require("../components/privacy-consent.tsx");
const { PRIVACY_CONSENT_STORAGE_KEY, PRIVACY_CONSENT_EVENT, savePrivacyConsent, readPrivacyConsent, parsePrivacyConsent } = require("../lib/privacy-consent.ts");
const { renderToStaticMarkup } = require("react-dom/server");
beforeEach(() => ui.window.localStorage.clear());
afterEach(() => ui.cleanup());
after(() => ui.dispose());
function show() { return render(h(PrivacyConsentProvider, null, h("main", null, "Application"))); }
function assertTelemetry(view, analytics, performance) {
  assert.equal(Boolean(view.queryByTestId("analytics")), analytics);
  assert.equal(Boolean(view.queryByTestId("speed-insights")), performance);
  assert.equal(Boolean(view.queryByTestId("web-vitals")), performance);
}

test("privacy consent renders no optional telemetry before hydration or a decision", () => {
  const server = renderToStaticMarkup(h(PrivacyConsentProvider, null, "Application"));
  assert.equal(server, "Application");
  const view = show();
  const dialog = view.getByRole("dialog", { name: "Your privacy choices" });
  assert.equal(dialog.tagName, "DIALOG");
  assert.equal(dialog.getAttribute("aria-modal"), "false");
  assert.match(document.getElementById(dialog.getAttribute("aria-describedby")).textContent, /only with your permission/);
  assert.equal(view.getByRole("link", { name: "Privacy policy" }).getAttribute("href"), "/privacy-policy");
  assertTelemetry(view, false, false);
  fireEvent.click(view.getByRole("button", { name: "Essential only" }));
  assert.equal(view.queryByRole("dialog"), null);
  assertTelemetry(view, false, false);
  const saved = JSON.parse(ui.window.localStorage.getItem(PRIVACY_CONSENT_STORAGE_KEY));
  assert.equal(saved.analytics, false);
  assert.equal(saved.performance, false);
  assert.ok(Number.isFinite(Date.parse(saved.decidedAt)));
});

test("accepting optional telemetry enables all providers and restores that choice on the next mount", () => {
  const view = show();
  fireEvent.click(view.getByRole("button", { name: "Accept optional" }));
  assertTelemetry(view, true, true);
  assert.equal(view.queryByRole("dialog"), null);
  view.unmount();
  const next = show();
  assertTelemetry(next, true, true);
  assert.equal(next.queryByRole("dialog"), null);
});

for (const [analytics, performance] of [[false, true], [true, false], [false, false]]) {
  test(`custom privacy choices independently enable analytics=${analytics} and performance=${performance}`, () => {
    const view = show();
    fireEvent.click(view.getByRole("button", { name: "Customize" }));
    assert.ok(view.getByRole("group", { name: "Optional data" }));
    const [analyticsInput, performanceInput] = view.getAllByRole("checkbox");
    if (analytics) fireEvent.click(analyticsInput);
    if (performance) fireEvent.click(performanceInput);
    fireEvent.click(view.getByRole("button", { name: "Save choices" }));
    assertTelemetry(view, analytics, performance);
    assert.equal(view.queryByRole("dialog"), null);
    const saved = JSON.parse(ui.window.localStorage.getItem(PRIVACY_CONSENT_STORAGE_KEY));
    assert.deepEqual([saved.analytics, saved.performance], [analytics, performance]);
  });
}

test("privacy updates from settings immediately stop telemetry and remove their event listener on unmount", (t) => {
  const view = show();
  ui.act(() => savePrivacyConsent({ analytics: true, performance: true }));
  assertTelemetry(view, true, true);
  ui.act(() => savePrivacyConsent({ analytics: false, performance: false }));
  assertTelemetry(view, false, false);
  const remove = t.mock.method(ui.window, "removeEventListener");
  view.unmount();
  assert.ok(remove.mock.calls.some(({ arguments: args }) => args[0] === PRIVACY_CONSENT_EVENT));
});

test("consent hooks explain when their provider is missing", (t) => {
  t.mock.method(console, "error", () => {});
  function Orphan() { usePrivacyConsent(); return null; }
  assert.throws(() => render(h(Orphan)), /usePrivacyConsent must be used within PrivacyConsentProvider/);
});

test("stored consent validates both preferences and tolerates malformed, legacy, or inaccessible browser storage", (t) => {
  for (const value of [null, "", "{", "null", "{}", '{"analytics":"yes","performance":true}', '{"analytics":true,"performance":"yes"}']) assert.equal(parsePrivacyConsent(value), null);
  assert.deepEqual(parsePrivacyConsent('{"analytics":false,"performance":true}'), { analytics: false, performance: true, decidedAt: new Date(0).toISOString() });
  t.mock.method(ui.window.localStorage, "getItem", () => { throw new Error("Storage blocked"); });
  t.mock.method(ui.window.localStorage, "setItem", () => { throw new Error("Storage blocked"); });
  assert.equal(readPrivacyConsent(), null);
  const view = show();
  fireEvent.click(view.getByRole("button", { name: "Accept optional" }));
  assertTelemetry(view, true, true);
  assert.equal(view.queryByRole("dialog"), null);
});

test("server-side consent helpers have no browser side effects", () => {
  const original = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(readPrivacyConsent(), null);
    const consent = savePrivacyConsent({ analytics: false, performance: false });
    assert.equal(consent.analytics, false);
    assert.equal(consent.performance, false);
    assert.ok(Number.isFinite(Date.parse(consent.decidedAt)));
  } finally {
    globalThis.window = original;
  }
});
