import assert from "node:assert/strict";
import test from "node:test";
import { createCreditTransactionsHarness, cardFixture, creditFixture, creditResponse } from "./credit-transactions-page-harness.mjs";

const { ui, fixtures, requests, setUrl, show, loaded, change } = await createCreditTransactionsHarness();
const lastFilter = () => requests.filter(({ url }) => url.pathname === "/api/credit-transactions").at(-1)?.url.searchParams;
const expectFilter = async fields => ui.waitFor(() => {
  for (const [name, value] of Object.entries(fields)) assert.equal(lastFilter()?.get(name), value);
});
const cardTrigger = view => view.container.querySelector(".cct-mobile-card-trigger");
const cardOptions = view => ui.within(view.getByRole("listbox", { name: "Credit cards" }));

for (const [month, expected, label] of [["all", null, "All months"], ["-1", null, "All months"], ["1", "1", "Jan"], ["12", "12", "Dec"], ["13", "10", "Oct"], ["bad", "10", "Oct"]]) {
  test(`URL statement month ${month} uses the supported period or the current-month fallback`, async () => {
    document.cookie = "nest_credit_tx_month=2; Path=/";
    setUrl(`cardId=card-one&month=${month}&year=2026`);
    const view = show();
    await loaded(view);
    await expectFilter({ month: expected });
    assert.equal(view.getByRole("button", { name: "Statement month", exact: true }).textContent, label);
  });
}

for (const [saved, expected] of [["-1", null], ["0", "1"], ["11", "12"], ["12", "10"], ["bad", "10"]]) {
  test(`saved statement month ${saved} is restored only when valid`, async () => {
    document.cookie = `nest_credit_tx_month=${saved}; Path=/`;
    document.cookie = "nest_credit_tx_card=card-two; Path=/";
    setUrl("");
    const view = show([cardFixture(), cardFixture({ id: "card-two", cardName: "Travel card" })]);
    await loaded(view);
    await expectFilter({ cardId: "card-two", month: expected });
    assert.ok(ui.within(cardTrigger(view)).getByText("Travel card"));
  });
}

test("URL filters take precedence over saved card, month, year and unaccounted preferences", async () => {
  document.cookie = "nest_credit_tx_card=card-two; Path=/";
  document.cookie = "nest_credit_tx_month=4; Path=/";
  sessionStorage.setItem("nest:view:credit-transactions:year", "2024");
  sessionStorage.setItem("nest:view:credit-transactions:unaccounted", "true");
  setUrl("cardId=card-one&month=2&year=2025&unaccounted=0");
  const view = show([cardFixture(), cardFixture({ id: "card-two", cardName: "Travel card" })]);
  await loaded(view);
  await expectFilter({ cardId: "card-one", month: "2", year: "2025" });
  assert.equal(view.getByRole("checkbox", { name: "Unaccounted only" }).checked, false);
  assert.ok(ui.within(cardTrigger(view)).getByText("Daily card"));
  assert.match(document.cookie, /nest_credit_tx_card=card-one/);
});

for (const year of ["2019", "2101", "bad"]) {
  test(`invalid statement year ${year} and a removed card fall back to the current year and all cards`, async () => {
    setUrl(`cardId=removed&year=${year}&unaccounted=true`);
    const view = show();
    await loaded(view);
    await expectFilter({ cardId: "all", year: "2026" });
    assert.ok(ui.within(cardTrigger(view)).getByText("All cards"));
    assert.equal(view.getByRole("checkbox", { name: "Unaccounted only" }).checked, true);
  });
}

test("the mobile card picker selects a card, persists it, handles failed logos and returns to all cards", async () => {
  const view = show([cardFixture(), cardFixture({ id: "card-two", cardName: "Travel card", bankName: null })]);
  await loaded(view);
  ui.fireEvent.error(cardTrigger(view).querySelector("img"));
  assert.ok(!cardTrigger(view).querySelector("img"));
  ui.fireEvent.click(cardTrigger(view));
  assert.equal(cardTrigger(view).getAttribute("aria-expanded"), "true");
  assert.ok(!view.queryByRole("searchbox"));
  assert.equal(cardOptions(view).getByRole("option", { name: /Daily card/ }).getAttribute("aria-selected"), "true");
  ui.fireEvent.click(cardOptions(view).getByRole("option", { name: /Travel card/ }));
  await expectFilter({ cardId: "card-two" });
  assert.equal(cardTrigger(view).getAttribute("aria-expanded"), "false");
  assert.match(cardTrigger(view).textContent, /Travel cardCard ••1234/);
  assert.match(document.cookie, /nest_credit_tx_card=card-two/);
  ui.fireEvent.click(cardTrigger(view));
  ui.fireEvent.click(cardOptions(view).getByRole("option", { name: /All cards/ }));
  await expectFilter({ cardId: "all" });
  assert.match(cardTrigger(view).textContent, /All cards2 cards/);
  ui.fireEvent.click(cardTrigger(view));
  assert.equal(cardOptions(view).getByRole("option", { name: /All cards/ }).getAttribute("aria-selected"), "true");
  ui.fireEvent.click(cardTrigger(view));
  assert.ok(!view.queryByRole("listbox"));
});

test("card search matches name, bank and final digits, reports no results, and clears after selection", async () => {
  const cards = [cardFixture(), ...Array.from({ length: 6 }, (_, i) => cardFixture({ id: `card-${i + 2}`, cardName: `Travel ${i}`, bankName: i ? null : "OCBC", last4Digit: String(7000 + i) }))];
  const view = show(cards);
  await loaded(view);
  ui.fireEvent.click(cardTrigger(view));
  const search = view.getByRole("searchbox", { name: "Search cards" });
  for (const query of ["Travel 0", "ocbc", "7000"]) {
    ui.fireEvent.change(search, { target: { value: query } });
    assert.equal(cardOptions(view).getAllByRole("option").length, 1);
    assert.match(cardOptions(view).getByRole("option").textContent, /Travel 0/);
  }
  ui.fireEvent.error(cardOptions(view).getByRole("option").querySelector("img"));
  assert.ok(!cardOptions(view).getByRole("option").querySelector("img"));
  ui.fireEvent.change(search, { target: { value: "missing" } });
  assert.ok(view.getByText("No matching cards."));
  assert.equal(cardOptions(view).queryAllByRole("option").length, 0);
  ui.fireEvent.change(search, { target: { value: "Travel 0" } });
  ui.fireEvent.click(cardOptions(view).getByRole("option"));
  await expectFilter({ cardId: "card-2" });
  ui.fireEvent.click(cardTrigger(view));
  assert.equal(view.getByRole("searchbox").value, "");
  assert.equal(cardOptions(view).getAllByRole("option").length, 8);
});

test("month and year pickers show due-date urgency, select periods and close other open pickers", async () => {
  fixtures.set("GET /api/credit-transactions/payment-due", { months: [{ statementMonth: 9, paymentDueDate: "2026-10-13" }, { statementMonth: 10, paymentDueDate: "2026-10-20" }] });
  const view = show();
  await loaded(view);
  const month = view.getByRole("button", { name: "Statement month", exact: true });
  const year = view.getByRole("button", { name: "Statement year", exact: true });
  await ui.waitFor(() => assert.equal(month.classList.contains("is-due-later"), true));
  ui.fireEvent.click(cardTrigger(view));
  ui.fireEvent.click(month);
  assert.ok(!view.queryByRole("listbox", { name: "Credit cards" }));
  const months = ui.within(view.getByRole("listbox", { name: "Statement months" }));
  assert.equal(months.getByRole("option", { name: "Sep, payment due" }).classList.contains("is-due-soon"), true);
  assert.equal(months.getByRole("option", { name: "Oct, payment due" }).classList.contains("is-due-later"), true);
  assert.equal(months.getByRole("option", { name: "Oct, payment due" }).getAttribute("aria-selected"), "true");
  ui.fireEvent.click(months.getByRole("option", { name: "Sep, payment due" }));
  await expectFilter({ month: "9" });
  assert.equal(month.getAttribute("aria-expanded"), "false");
  assert.equal(month.classList.contains("is-due-soon"), true);
  ui.fireEvent.click(month);
  ui.fireEvent.click(year);
  assert.ok(!view.queryByRole("listbox", { name: "Statement months" }));
  const years = ui.within(view.getByRole("listbox", { name: "Statement years" }));
  assert.equal(years.getByRole("option", { name: "2026" }).getAttribute("aria-selected"), "true");
  ui.fireEvent.click(years.getByRole("option", { name: "2025" }));
  await expectFilter({ year: "2025" });
  ui.fireEvent.click(year);
  ui.fireEvent.click(cardTrigger(view));
  assert.ok(!view.queryByRole("listbox", { name: "Statement years" }));
  ui.fireEvent.click(month);
  ui.fireEvent.click(view.getByRole("option", { name: "All months" }));
  await expectFilter({ month: null });
  assert.equal(month.classList.contains("is-due-soon"), false);
  assert.equal(month.classList.contains("is-due-later"), false);
});

test("picker dismissal respects inside clicks, outside clicks and Escape", async () => {
  const view = show();
  await loaded(view);
  for (const trigger of [cardTrigger(view), view.getByRole("button", { name: "Statement month", exact: true }), view.getByRole("button", { name: "Statement year", exact: true })]) {
    ui.fireEvent.click(trigger);
    ui.fireEvent.pointerDown(view.getByRole("listbox"));
    ui.fireEvent.keyDown(document, { key: "Tab" });
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    ui.fireEvent.keyDown(document, { key: "Escape" });
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    ui.fireEvent.click(trigger);
    ui.fireEvent.pointerDown(document.body);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
  }
});

test("desktop card and month rails navigate, center selected filters and update overflow controls", async t => {
  const view = show([cardFixture(), cardFixture({ id: "card-two", cardName: "Travel card" })]);
  await loaded(view);
  const rail = view.container.querySelector(".cct-card-bar");
  Object.defineProperties(rail, { clientWidth: { configurable: true, value: 400 }, scrollWidth: { configurable: true, value: 1000 } });
  const scrollBy = t.mock.method(rail, "scrollBy", () => {});
  const scrollTo = t.mock.method(rail, "scrollTo", () => {});
  ui.fireEvent.scroll(rail);
  assert.equal(view.getByRole("button", { name: "Show previous cards" }).disabled, true);
  assert.equal(view.getByRole("button", { name: "Show more cards" }).disabled, false);
  ui.fireEvent.click(view.getByRole("button", { name: "Show more cards" }));
  assert.equal(scrollBy.mock.calls[0].arguments[0].left, 288);
  rail.scrollLeft = 600;
  ui.fireEvent.scroll(rail);
  assert.equal(view.getByRole("button", { name: "Show more cards" }).disabled, true);
  ui.fireEvent.click(view.getByRole("button", { name: "Show previous cards" }));
  assert.equal(scrollBy.mock.calls[1].arguments[0].left, -288);
  ui.fireEvent.click(ui.within(rail).getByRole("button", { name: /Travel card/ }));
  await expectFilter({ cardId: "card-two" });
  assert.ok(scrollTo.mock.callCount() > 0);
  ui.fireEvent.error(rail.querySelector("img"));
  assert.ok(rail.querySelector(".cct-card-chip-icon"));
  ui.fireEvent.click(view.getByRole("button", { name: /All Cards/ }));
  await expectFilter({ cardId: "all" });
  const months = view.container.querySelector(".cct-month-tabs");
  months.scrollLeft = 15;
  ui.fireEvent.scroll(months);
  assert.equal(months.parentElement.classList.contains("is-scrolled"), true);
  ui.fireEvent.click(ui.within(months).getByRole("button", { name: "Mar" }));
  await expectFilter({ month: "3" });
  ui.fireEvent.click(view.getByRole("button", { name: "All", exact: true }));
  await expectFilter({ month: null });
  change(view, "Statement Year", "2023");
  await expectFilter({ year: "2023" });
});

test("all-card counts and the picker remain usable when every transaction is already accounted", async () => {
  fixtures.set("GET /api/credit-transactions", creditResponse([creditFixture({ isAllocated: true })]));
  setUrl("cardId=all&month=all&year=2030");
  const view = show();
  await loaded(view);
  assert.match(cardTrigger(view).textContent, /1 card/);
  assert.ok(!cardTrigger(view).querySelector(".cct-mobile-card-count"));
  ui.fireEvent.click(cardTrigger(view));
  assert.ok(!view.getByRole("listbox").querySelector(".cct-mobile-card-count"));
  ui.fireEvent.click(view.getByRole("button", { name: "Statement year", exact: true }));
  assert.equal(view.getByRole("option", { name: "2030" }).getAttribute("aria-selected"), "true");
});
