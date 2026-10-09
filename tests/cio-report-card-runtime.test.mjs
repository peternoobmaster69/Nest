import assert from "node:assert/strict";
import test from "node:test";
import { createCioUiHarness, deferred, reportFixture } from "./cio-ui-harness.mjs";

const harness = await createCioUiHarness();
const { ui, require, fixtures, requests, notifications, show, element } = harness;
const { fireEvent, waitFor, within } = ui;
const { CioStrategyReportsCard } = require("../components/cio/cio-strategy-reports-card.tsx");

test("the report archive loads private workspace data and can recover after a failed request", async () => {
  const pending = deferred();
  fixtures.set("GET /api/cio/reports", () => pending.promise);
  const view = show(CioStrategyReportsCard, { canEdit: true });
  assert.ok(view.getByText("Loading reports…"));
  assert.ok(!view.queryByText("No strategy report yet"));
  await ui.act(async () => pending.resolve(Response.json({ error: "Archive unavailable" }, { status: 503 })));
  await view.findByRole("alert");
  assert.ok(!view.queryByText("No strategy report yet"));
  fixtures.set("GET /api/cio/reports", { reports: [] });
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await view.findByText("No strategy report yet");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.headers.get("x-workspace-id") === "household" && request.cache === "no-store"));
});

test("a report archive without a selected workspace does not fetch another workspace's records", () => {
  ui.window.history.replaceState(null, "", "/cio");
  const view = show(CioStrategyReportsCard, { canEdit: false });
  assert.ok(view.getByText("No strategy report yet"));
  assert.equal(requests.length, 0);
  assert.equal(view.getByRole("button", { name: "Generate report" }).disabled, true);
});

test("snapshots retain their order, recorded recommendations, status, dates, and completeness", async () => {
  const topRecommendations = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((severity, index) => ({ id: `action-${index}`, severity, category: index === 0 ? "DATA_QUALITY" : "ALLOCATION", title: `Recommendation ${index}`, action: `Recorded action ${index}` }));
  fixtures.set("GET /api/cio/reports", { reports: [reportFixture({ topRecommendations }), reportFixture({ id: "legacy", title: "Earlier strategy", generatedAt: "Legacy date", strategyStatus: "ON_TRACK", completenessBps: 8000 })] });
  const view = show(CioStrategyReportsCard, { canEdit: true });
  const latest = await view.findByRole("article", { name: "Household strategy" });
  const earlier = view.getByRole("article", { name: "Earlier strategy" });
  assert.equal(view.getAllByRole("article")[0], latest);
  assert.ok(latest.classList.contains("is-latest"));
  assert.ok(!earlier.classList.contains("is-latest"));
  for (const label of ["Latest snapshot", "Action required", "95%", "Data quality", "Act now", "Prioritize", "Review", "On track"]) assert.ok(within(latest).getByText(label));
  assert.ok(within(earlier).getByText("Earlier snapshot"));
  assert.ok(within(earlier).getByText("Legacy date"));
  assert.ok(within(earlier).getByText("No recommendations were recorded in this snapshot."));
  assert.equal(view.getByRole("button", { name: "Generate report" }).disabled, false);
  assert.equal(within(latest).getAllByRole("listitem").length, 4);
});

test("only editors can generate a report and the latest snapshot enforces the thirty-day cooldown", async () => {
  const now = new Date();
  fixtures.set("GET /api/cio/reports", { reports: [reportFixture({ generatedAt: now.toISOString() })] });
  const view = show(CioStrategyReportsCard, { canEdit: false });
  await view.findByRole("article");
  let button = view.getByRole("button", { name: "Generate report" });
  assert.equal(button.disabled, true);
  assert.equal(button.title, "Editor access is required");
  fireEvent.click(button);
  view.rerender(element(CioStrategyReportsCard, { canEdit: true }));
  button = view.getByRole("button", { name: "Generate report" });
  assert.equal(button.disabled, true);
  const next = new Date(now.getTime() + 30 * 86400_000);
  assert.equal(button.title, `The next report can be generated on ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(next)}.`);
  assert.ok(view.getByText(`Next report ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium" }).format(next)}`));
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("generating a report prevents repeat clicks while pending and refreshes the archive after saving", async () => {
  const pending = deferred();
  fixtures.set("POST /api/cio/reports", () => pending.promise);
  const view = show(CioStrategyReportsCard, { canEdit: true });
  await view.findByText("No strategy report yet");
  assert.equal(view.getByRole("button", { name: "Generate report" }).title, "Generate a strategy report");
  fireEvent.click(view.getByRole("button", { name: "Generate report" }));
  await waitFor(() => assert.equal(view.getByRole("button", { name: "Generate report" }).getAttribute("aria-busy"), "true"));
  fireEvent.click(view.getByRole("button", { name: "Generate report" }));
  const writes = requests.filter((request) => request.method === "POST");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, {});
  assert.equal(writes[0].headers.get("content-type"), "application/json");
  assert.equal(writes[0].headers.get("x-workspace-id"), "household");
  const report = reportFixture({ generatedAt: new Date().toISOString() });
  fixtures.set("GET /api/cio/reports", { reports: [report] });
  await ui.act(async () => pending.resolve(Response.json({ report }, { status: 201 })));
  await view.findByRole("article", { name: report.title });
  await waitFor(() => assert.deepEqual(notifications, [["success", "CIO strategy report generated."]]));
  assert.equal(requests.filter((request) => request.method === "GET").length, 2);
  assert.equal(view.getByRole("button", { name: "Generate report" }).disabled, true);
});

for (const [label, failure, expected] of [
  ["cooldown", () => Response.json({ code: "CIO_STRATEGY_REPORT_COOLDOWN", error: "A report can be generated next month." }, { status: 409 }), "A report can be generated next month."],
  ["permission", () => Response.json({ error: "Editor required" }, { status: 403 }), "You do not have permission to make this change."],
  ["network", () => { throw new Error("Connection interrupted"); }, "Connection interrupted"],
]) {
  test(`a ${label} generation failure is visible and leaves the action retryable`, async () => {
    fixtures.set("POST /api/cio/reports", failure);
    const view = show(CioStrategyReportsCard, { canEdit: true });
    await view.findByText("No strategy report yet");
    fireEvent.click(view.getByRole("button", { name: "Generate report" }));
    await waitFor(() => assert.deepEqual(notifications, [["error", expected]]));
    assert.equal(view.getByRole("button", { name: "Generate report" }).disabled, false);
    assert.ok(view.getByText("No strategy report yet"));
  });
}

for (const [disposition, expected] of [["attachment; filename=\"Household-CIO.pdf\"", "Household-CIO.pdf"], [null, "CIO-Strategy-2026-07-01.pdf"], ["attachment", "CIO-Strategy-2026-07-01.pdf"]]) {
  test(`PDF downloads use ${disposition ?? "no filename header"} and release the temporary object URL`, async (t) => {
    const report = reportFixture({ id: "archive/id" });
    fixtures.set("GET /api/cio/reports", { reports: [report, reportFixture({ id: "earlier", title: "Earlier strategy" })] });
    const pending = deferred();
    fixtures.set("GET /api/cio/reports/archive%2Fid/pdf", () => pending.promise);
    const blobs = [], downloads = [], revoked = [];
    t.mock.method(URL, "createObjectURL", (blob) => { blobs.push(blob); return "blob:http://localhost/report"; });
    t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
    t.mock.method(ui.window.HTMLAnchorElement.prototype, "click", function () { downloads.push({ url: this.href, filename: this.download, connected: this.isConnected }); });
    const view = show(CioStrategyReportsCard, { canEdit: false });
    const latest = await view.findByRole("article", { name: report.title });
    const button = within(latest).getByRole("button", { name: "Download PDF" });
    fireEvent.click(button);
    await waitFor(() => assert.equal(button.disabled, true));
    assert.equal(within(view.getByRole("article", { name: "Earlier strategy" })).getByRole("button", { name: "Download PDF" }).disabled, false);
    const headers = { "content-type": "application/pdf" };
    if (disposition) headers["content-disposition"] = disposition;
    await ui.act(async () => pending.resolve(new Response("%PDF-fixture", { headers })));
    await waitFor(() => assert.equal(downloads.length, 1));
    assert.deepEqual(downloads[0], { url: "blob:http://localhost/report", filename: expected, connected: true });
    assert.equal(await blobs[0].text(), "%PDF-fixture");
    assert.ok(!document.querySelector("a[download]"));
    assert.equal(requests.at(-1).headers.get("x-workspace-id"), "household");
    assert.equal(requests.at(-1).cache, "no-store");
    await waitFor(() => assert.deepEqual(revoked, ["blob:http://localhost/report"]), { timeout: 2500 });
    assert.equal(button.disabled, false);
    assert.deepEqual(notifications, []);
  });
}

for (const [label, failure, expected] of [
  ["API error", () => Response.json({ error: "Report expired" }, { status: 404 }), "Report expired"],
  ["unexpected error payload", () => Response.json({ error: 123 }, { status: 500 }), "PDF download failed (500)."],
  ["invalid JSON", () => new Response("Unavailable", { status: 503 }), "PDF download failed (503)."],
  ["non-error rejection", () => { throw "Network unavailable"; }, "The PDF could not be downloaded."],
]) {
  test(`a PDF ${label} does not create a broken download and can be retried`, async () => {
    fixtures.set("GET /api/cio/reports", { reports: [reportFixture()] });
    fixtures.set("GET /api/cio/reports/report-1/pdf", failure);
    const view = show(CioStrategyReportsCard, { canEdit: false });
    const button = await view.findByRole("button", { name: "Download PDF" });
    fireEvent.click(button);
    await waitFor(() => assert.deepEqual(notifications, [["error", expected]]));
    assert.equal(button.disabled, false);
    assert.ok(!document.querySelector("a[download]"));
  });
}
