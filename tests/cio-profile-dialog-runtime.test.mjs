import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createCioDialogHarness } from "./cio-dialog-harness.mjs";

const harness = await createCioDialogHarness();
const { ui, require, fixtures, requests, events, fill, writes } = harness;
const { fireEvent, waitFor } = ui;
const { CioProfileDialog } = require("../components/cio/dialogs/cio-profile-dialog.tsx");
const { queryKeys } = require("../lib/query-keys.ts");
const profile = (overrides = {}) => ({
  id: "profile", planningScope: "INDIVIDUAL", primaryBirthDate: null, primaryCurrentAge: null, primaryAgeAsOfDate: null,
  partnerBirthDate: null, targetRetirementAge: null, targetRetirementDate: null, targetMonthlyRetirementSpendingCents: null,
  essentialMonthlySpendingCents: null, minimumImmediateBankCashCents: null, inflationRateBps: null, bearReturnBps: null,
  baseReturnBps: null, bullReturnBps: null, sustainableWithdrawalRateBps: null, annualExternalContributionOverrideCents: null,
  contributionGrowthRateBps: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...overrides,
});
beforeEach(() => {
  fixtures.set("/api/cio/profile", { profile: null });
  fixtures.set("PATCH /api/cio/profile", ({ body }) => Response.json({ profile: profile(body) }));
});
const show = (props) => harness.show(CioProfileDialog, props);
const element = (props) => harness.element(CioProfileDialog, props);
const submit = (view) => fireEvent.submit(view.getByLabelText(/^Your date of birth/).closest("form"));
const ready = (view) => view.findByLabelText(/^Your date of birth/);

test("planning profiles wait for an open workspace and restore their saved values when reopened", async () => {
  const view = show({ open: false });
  assert.ok(!view.queryByRole("dialog"));
  assert.deepEqual(requests, []);
  view.rerender(element({ workspaceId: undefined }));
  assert.deepEqual(requests, []);
  assert.equal(view.getByLabelText(/^Who are these/).value, "INDIVIDUAL");
  view.rerender(element());
  await ready(view);
  fill(view, /^Current age/, "30");
  view.rerender(element({ open: false }));
  view.rerender(element());
  await waitFor(() => assert.equal(view.getByLabelText(/^Current age/).value, ""));
  assert.equal(requests[0].headers.get("x-workspace-id"), "household");
  fireEvent.click(view.getByRole("button", { name: "Cancel", exact: true }));
  assert.deepEqual(events, ["close"]);
});

test("household profiles calculate age from birth and save money, rate and retirement-date assumptions", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  const view = show();
  await ready(view);
  fill(view, /^Who are these/, "HOUSEHOLD");
  fill(view, /^Your date of birth/, "1980-10-09");
  assert.equal(view.getByLabelText(/^Current age/).value, "46");
  assert.equal(view.getByLabelText(/^Current age/).readOnly, true);
  assert.ok(!view.queryByLabelText(/^Age correct as of/));
  fill(view, /^Partner's date of birth/, "1982-02-01");
  fill(view, /^Target retirement age/, "65");
  fill(view, /^Target retirement date/, "2045-01-01");
  assert.equal(view.getByLabelText(/^Target retirement age/).value, "");
  fill(view, /^Target retirement date/, "");
  fill(view, /^Target retirement age/, "65");
  fill(view, /^Target retirement age/, "");
  fill(view, /^Target retirement date/, "2046-01-01");
  for (const [label, value] of [
    [/^Target monthly retirement spending/, "5000.25"], [/^Essential monthly spending/, "0"], [/^Minimum immediate bank cash/, "30000"],
    [/^Annual contribution override/, "12000"], [/^Inflation rate/, "2.5"], [/^Contribution growth/, "3"],
    [/^Bear return/, "-1.25"], [/^Base return/, "6.25"], [/^Bull return/, "8"], [/^Sustainable withdrawal rate/, "4"],
  ]) fill(view, label, value);
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.deepEqual(writes()[0].body, { planningScope: "HOUSEHOLD", primaryBirthDate: "1980-10-09T00:00:00.000Z",
    primaryCurrentAge: null, primaryAgeAsOfDate: null, partnerBirthDate: "1982-02-01T00:00:00.000Z", targetRetirementAge: null,
    targetRetirementDate: "2046-01-01T00:00:00.000Z", targetMonthlyRetirementSpendingCents: 500025, essentialMonthlySpendingCents: 0,
    minimumImmediateBankCashCents: 3000000, annualExternalContributionOverrideCents: 1200000, inflationRateBps: 250,
    contributionGrowthRateBps: 300, bearReturnBps: -125, baseReturnBps: 625, bullReturnBps: 800, sustainableWithdrawalRateBps: 400 });
  assert.deepEqual(harness.client().getQueryData(queryKeys.cioProfile("household")), profile(writes()[0].body));
});

test("manual age preserves its reference date, yields to birth dates, and excludes partner details from individual plans", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-09T12:00:00Z") });
  const view = show();
  await ready(view);
  fill(view, /^Current age/, "40");
  assert.equal(view.getByLabelText(/^Age correct as of/).value, "2026-10-09");
  fill(view, /^Age correct as of/, "2025-01-01");
  fill(view, /^Current age/, "41");
  assert.equal(view.getByLabelText(/^Age correct as of/).value, "2025-01-01");
  fill(view, /^Current age/, "");
  assert.equal(view.getByLabelText(/^Age correct as of/).value, "");
  fill(view, /^Current age/, "42");
  fill(view, /^Your date of birth/, "1980-01-01");
  assert.equal(view.getByLabelText(/^Current age/).readOnly, true);
  fill(view, /^Your date of birth/, "");
  assert.equal(view.getByLabelText(/^Current age/).value, "");
  assert.equal(view.getByLabelText(/^Age correct as of/).value, "");
  fill(view, /^Current age/, "42");
  fill(view, /^Who are these/, "HOUSEHOLD");
  fill(view, /^Partner's date of birth/, "1982-01-01");
  fill(view, /^Who are these/, "INDIVIDUAL");
  assert.ok(!view.queryByLabelText(/^Partner's date of birth/));
  fill(view, /^Who are these/, "HOUSEHOLD");
  assert.equal(view.getByLabelText(/^Partner's date of birth/).value, "");
  fill(view, /^Who are these/, "INDIVIDUAL");
  fill(view, /^Target retirement date/, "2040-01-01");
  fill(view, /^Target retirement age/, "65");
  assert.equal(view.getByLabelText(/^Target retirement date/).value, "");
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
  assert.equal(writes()[0].body.primaryCurrentAge, 42);
  assert.equal(writes()[0].body.primaryAgeAsOfDate, "2026-10-09T00:00:00.000Z");
  assert.equal(writes()[0].body.primaryBirthDate, null);
  assert.equal(writes()[0].body.partnerBirthDate, null);
  assert.equal(writes()[0].body.targetRetirementAge, 65);
  assert.equal(writes()[0].body.targetRetirementDate, null);
});

test("invalid planning values explain errors before submission and update validation as fields are corrected", async () => {
  fixtures.set("/api/cio/profile", { profile: profile({ primaryBirthDate: "2099-01-01" }) });
  const view = show();
  await ready(view);
  assert.equal(view.getByLabelText(/^Current age/).value, "");
  submit(view);
  assert.ok(view.getByText("Date of birth cannot be in the future."));
  assert.ok(view.getByText("Review the highlighted fields before saving."));
  assert.equal(view.getByLabelText(/^Your date of birth/).getAttribute("aria-invalid"), "true");
  assert.deepEqual(writes(), []);
  fill(view, /^Your date of birth/, "1980-01-01");
  assert.ok(!view.queryByRole("alert"));
  fill(view, /^Target monthly retirement spending/, "-1");
  assert.ok(view.getByText(/Retirement spending must be between/));
  submit(view);
  assert.deepEqual(writes(), []);
  fill(view, /^Target monthly retirement spending/, "1");
  assert.ok(!view.queryByRole("alert"));
  submit(view);
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
});

test("profile fetch and save failures remain recoverable and pending writes prevent dismissal", async () => {
  fixtures.set("/api/cio/profile", () => Response.json({ error: "Unavailable" }, { status: 500 }));
  const view = show();
  await view.findByRole("heading", { name: "Profile could not be loaded" });
  fixtures.set("/api/cio/profile", { profile: profile({ primaryCurrentAge: 40, primaryAgeAsOfDate: "2026-01-01" }) });
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await ready(view);
  assert.equal(view.getByLabelText(/^Current age/).value, "40");
  fixtures.set("PATCH /api/cio/profile", () => Response.json({ error: "Save failed" }, { status: 422 }));
  submit(view);
  await view.findByText("Save failed");
  const pending = Promise.withResolvers();
  fixtures.set("PATCH /api/cio/profile", () => pending.promise);
  submit(view);
  await waitFor(() => assert.equal(writes().length, 2));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true));
  assert.equal(view.getByRole("button", { name: "Save profile" }).disabled, true);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.deepEqual(events, []);
  await ui.act(async () => pending.resolve(Response.json({ profile: profile() })));
  await waitFor(() => assert.deepEqual(events, ["saved", "close"]));
});
