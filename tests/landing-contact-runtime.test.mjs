import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor } = ui;
const require = createRequire(import.meta.url);
const { LandingContact } = require("../components/landing-contact.tsx");
beforeEach(() => ui.window.history.replaceState(null, "", "/?welcome=1"));
afterEach(async () => { ui.cleanup(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());

function show() {
  const view = render(h("main", null,
    h("a", { href: "#contact" }, "Contact link"),
    h("button", { "data-contact-open": true }, h("span", null, "Contact button")),
    h("button", null, "Unrelated action"),
    h(LandingContact),
  ));
  fireEvent.click(view.getByText("Contact button"));
  return view;
}

function fill(view, overrides = {}) {
  const values = { Name: " Ada Lovelace ", Email: "ada@example.com", Topic: "hosting", Message: "How do I host my own Nest instance?", ...overrides };
  for (const [label, value] of Object.entries(values)) fireEvent.change(view.getByRole(label === "Topic" ? "combobox" : "textbox", { name: label }), { target: { value } });
}

function submit(view) {
  fireEvent.submit(view.getByRole("dialog", { name: "Contact me" }).querySelector("form"));
}

test("contact form opens from nested triggers, links and the URL hash, while preserving a draft", () => {
  const view = show();
  fill(view);
  fireEvent.click(view.getByRole("button", { name: "Close Contact me" }));
  assert.ok(!view.queryByRole("dialog"));
  fireEvent.click(view.getByRole("button", { name: "Unrelated action" }));
  assert.ok(!view.queryByRole("dialog"));
  fireEvent.click(view.getByRole("link", { name: "Contact link" }));
  assert.equal(view.getByRole("textbox", { name: "Name" }).value, " Ada Lovelace ");
  fireEvent.click(view.getByRole("button", { name: "Close Contact me" }));
  ui.window.history.replaceState(null, "", "/?welcome=1#contact");
  fireEvent(ui.window, new ui.window.HashChangeEvent("hashchange"));
  assert.ok(view.getByRole("dialog", { name: "Contact me" }));
  fireEvent.click(view.getByRole("button", { name: "Close Contact me" }));
  assert.equal(ui.window.location.hash, "");
  assert.equal(ui.window.location.search, "?welcome=1");
  view.unmount();
  ui.window.history.replaceState(null, "", "/#contact");
  const fromHash = render(h(LandingContact));
  assert.ok(fromHash.getByRole("dialog", { name: "Contact me" }));
});

test("contact validation rejects incomplete fields and uses the same email policy as the server", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  const view = show();
  submit(view);
  await view.findByText("Enter your name.");
  for (const error of ["Enter your name.", "Enter a valid email address.", "Message should be at least 10 characters."]) assert.ok(view.getByText(error));
  fill(view, { Email: "a@b.c" });
  assert.ok(!view.queryByText("Enter your name."));
  submit(view);
  await waitFor(() => assert.equal(view.getByRole("button", { name: /Send message/ }).disabled, false));
  assert.ok(view.getByText("Enter a valid email address."));
  assert.equal(view.getByRole("textbox", { name: "Email" }).getAttribute("aria-invalid"), "true");
  fill(view, { Name: "a".repeat(121), Email: "ada@example.com", Message: "a".repeat(4001) });
  submit(view);
  await view.findByText("Name is too long.");
  assert.ok(view.getByText("Message must be 4000 characters or fewer."));
  assert.equal(fetch.mock.callCount(), 0);
});

test("successful contact submission sends form timing, locks the dialog while sending, and clears a completed draft", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-07T00:00:00Z") });
  let finish;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, ...init });
    return new Promise((resolve) => { finish = resolve; });
  });
  const view = show();
  fill(view);
  fireEvent.change(view.getByLabelText("Website"), { target: { value: "" } });
  t.mock.timers.tick(2500);
  submit(view);
  assert.equal(view.getByRole("button", { name: "Sending…" }).disabled, true);
  assert.equal(view.getByRole("button", { name: "Close Contact me" }).disabled, true);
  assert.ok([...view.getAllByRole("textbox"), view.getByRole("combobox")].every((control) => control.disabled));
  fireEvent.keyDown(ui.window.document, { key: "Escape" });
  assert.ok(view.getByRole("dialog", { name: "Contact me" }));
  await waitFor(() => assert.equal(typeof finish, "function"));
  await ui.act(async () => finish(Response.json({ sent: true })));
  const dialog = await view.findByRole("dialog", { name: "Message sent" });
  assert.ok(within(dialog).getByText("Thanks, Ada!"));
  assert.ok(within(dialog).getByText("ada@example.com"));
  assert.equal(within(dialog).getByRole("status").tagName, "OUTPUT");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/public/contact");
  assert.equal(requests[0].method, "POST");
  assert.equal(new Headers(requests[0].headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(requests[0].body), { name: " Ada Lovelace ", email: "ada@example.com", topic: "hosting", message: "How do I host my own Nest instance?", website: "", elapsedMs: 2500 });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close", exact: true }));
  fireEvent.click(view.getByRole("link", { name: "Contact link" }));
  assert.equal(view.getByRole("textbox", { name: "Name" }).value, "");
  assert.equal(view.getByRole("textbox", { name: "Email" }).value, "");
  assert.equal(view.getByRole("combobox", { name: "Topic" }).value, "general");
});

for (const [name, response, expected] of [
  ["rate limit", () => Response.json({ error: "Too many requests" }, { status: 429 }), "You've sent a few messages already. Please try again a little later."],
  ["server rejection", () => Response.json({ error: "Email is unavailable" }, { status: 503 }), "Email is unavailable"],
  ["empty error", () => Response.json({}, { status: 500 }), "Your message couldn't be sent. Please try again."],
  ["invalid response", () => new Response("Unavailable", { status: 502 }), "Your message couldn't be sent. Please try again."],
  ["connection failure", () => Promise.reject(new TypeError("Network unavailable")), "You appear to be offline. Check your connection and try again."],
]) {
  test(`contact ${name} preserves the message and allows retrying`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", response);
    const view = show();
    fill(view);
    submit(view);
    await view.findByRole("alert");
    assert.equal(view.getByRole("alert").textContent, expected);
    assert.equal(view.getByRole("textbox", { name: "Message" }).value, "How do I host my own Nest instance?");
    assert.equal(view.getByRole("button", { name: /Send message/ }).disabled, false);
    fetch.mock.mockImplementation(async () => Response.json({ sent: true }));
    submit(view);
    await view.findByRole("dialog", { name: "Message sent" });
    assert.equal(fetch.mock.callCount(), 2);
  });
}

test("server field errors identify affected controls and disappear as the user corrects them", async (t) => {
  const fieldErrors = { name: ["Check your name"], email: ["Check your email"], topic: ["Choose another topic"], message: ["Please clarify your message"] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ issues: { fieldErrors } }, { status: 422 }));
  const view = show();
  fill(view);
  submit(view);
  await view.findByText("Please check the highlighted fields.");
  for (const errors of Object.values(fieldErrors)) assert.ok(view.getByText(errors[0]));
  fill(view, { Name: "Ada", Email: "other@example.com", Topic: "feedback", Message: "Here is additional context for my question." });
  await waitFor(() => {
    for (const errors of Object.values(fieldErrors)) assert.ok(!view.queryByText(errors[0]));
  });
});

test("hidden honeypot validation never exposes the trap and leaves the server to reject bot submissions", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ sent: true }));
  const view = show();
  fill(view);
  fireEvent.change(view.getByLabelText("Website"), { target: { value: "x".repeat(501) } });
  submit(view);
  await view.findByRole("dialog", { name: "Message sent" });
  assert.equal(view.queryByRole("alert"), null);
  assert.equal(JSON.parse(fetch.mock.calls[0].arguments[1].body).website.length, 501);
});
