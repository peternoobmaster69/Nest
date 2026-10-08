import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach, mock } from "node:test";
import { createReactHarness } from "./react-harness.mjs";

const ui = await createReactHarness();
const { h, render, fireEvent, within, waitFor } = ui;
const require = createRequire(import.meta.url);
const calls = [];
let signIn;
let authenticate;
let fixtures;
const router = { replace: (...args) => calls.push(["replace", ...args]) };
mock.module("next-auth/react", { namedExports: {
  signIn: async (...args) => { calls.push(["signin", ...args]); return signIn(); },
  signOut: async (...args) => { calls.push(["signout", ...args]); },
} });
mock.module("next/navigation", { namedExports: { useRouter: () => router } });
mock.module(require.resolve("@simplewebauthn/browser"), { namedExports: { startAuthentication: async (options) => { calls.push(["authenticate", options]); return authenticate(); } } });
const { SignInPanel } = require("../components/signin-panel.tsx");
const { LandingSignInDialog } = require("../components/landing-signin-dialog.tsx");
const { rememberPostSignInDestination, consumePostSignInDestination, clearPostSignInDestination } = require("../lib/session-limit-client.ts");
const { DATABASE_UNAVAILABLE_CODE, DATABASE_UNAVAILABLE_MESSAGE } = require("../lib/database-errors.ts");
const destination = "/w/home/transactions?view=month";

function property(t, target, name, value) {
  const original = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
  t.after(() => { if (original) Object.defineProperty(target, name, original); else delete target[name]; });
}
function supportPasskeys(t, credentials = {}) {
  property(t, ui.window, "PublicKeyCredential", class PublicKeyCredential {});
  property(t, ui.window.navigator, "credentials", credentials);
}
beforeEach((t) => {
  calls.length = 0;
  ui.window.sessionStorage.clear();
  signIn = async () => ({ url: destination });
  authenticate = async () => ({ id: "fixture-credential" });
  property(t, ui.window, "PublicKeyCredential", undefined);
  t.mock.method(ui.window.location, "assign", (href) => calls.push(["assign", href]));
  fixtures = new Map([
    ["GET /api/auth/providers", () => Response.json({})],
    ["GET /api/auth/session-limit", () => Response.json({ sessions: [] })],
    ["POST /api/auth/session-limit", () => Response.json({ ok: true })],
    ["POST /api/passkeys/authenticate/options", () => Response.json({ challengeId: "fixture-challenge", options: { challenge: "fixture-options" } })],
    ["POST /api/passkeys/authenticate/verify", () => Response.json({ loginToken: "fixture-login-token" })],
  ]);
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push(["fetch", url, init]);
    const fixture = fixtures.get(`${init.method ?? "GET"} ${url}`);
    assert.ok(fixture, `Unexpected request ${url}`);
    return fixture(init);
  });
});
afterEach(async () => { ui.cleanup(); await ui.window.happyDOM.abort(); });
after(() => ui.dispose());
const requests = (url, method = "GET") => calls.filter(([type, path, options]) => type === "fetch" && path === url && (options.method ?? "GET") === method);
const session = (index, countryCode = "SG") => ({ sessionId: `session-${index}`, deviceName: `Device ${index}`, ipAddress: null, countryCode, provider: "google", signedInAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-08T04:00:00Z" });
function showSessionLimit() { return render(h(LandingSignInDialog, { callbackUrl: destination, sessionLimitRequired: true })); }

test("the landing sign-in dialog embeds configured providers and closes without losing the page scroll position", async () => {
  fixtures.set("GET /api/auth/providers", () => Response.json({ google: { id: "google", name: "Google", type: "oauth" } }));
  const view = render(h(LandingSignInDialog, { callbackUrl: destination, serviceMessage: "Maintenance notice" }));
  const dialog = view.getByRole("dialog", { name: "Sign in to Nest" });
  assert.equal(dialog.tagName, "DIALOG");
  await view.findByText("Maintenance notice");
  assert.ok(within(dialog).getByRole("button", { name: "Continue with Google" }));
  fireEvent.click(view.getByRole("button", { name: "Close sign in" }));
  assert.deepEqual(calls.at(-1), ["replace", "/", { scroll: false }]);
  assert.equal(calls.some(([type]) => type === "signout"), false);
});

test("session selection focuses the first device, supports individual and all selections, and sends only chosen identifiers", async () => {
  let finishRead;
  fixtures.set("GET /api/auth/session-limit", () => new Promise((resolve) => { finishRead = resolve; }));
  let finishApproval;
  fixtures.set("POST /api/auth/session-limit", () => new Promise((resolve) => { finishApproval = resolve; }));
  rememberPostSignInDestination(destination);
  const view = showSessionLimit();
  assert.ok(view.getByRole("heading", { name: "Checking active sessions" }));
  assert.equal(view.getByRole("button", { name: "Continue on this device" }).disabled, true);
  assert.equal(requests("/api/auth/session-limit")[0][2].cache, "no-store");
  const sessions = [session(1), session(2, null), session(3, "invalid-region"), session(4, "US"), session(5, "ZZ")];
  await ui.act(async () => finishRead(Response.json({ sessions })));
  await view.findByRole("heading", { name: "5 active sessions" });
  const checkboxes = view.getAllByRole("checkbox");
  assert.equal(document.activeElement, checkboxes[0]);
  assert.ok(view.getByText(/Location unavailable ·/));
  assert.ok(view.getByText(/invalid-region ·/));
  fireEvent.click(checkboxes[0]);
  assert.equal(view.getByRole("button", { name: "End session and continue" }).disabled, false);
  fireEvent.click(checkboxes[0]);
  assert.equal(view.getByRole("button", { name: "Continue on this device" }).disabled, true);
  fireEvent.click(view.getByRole("button", { name: "Select all" }));
  assert.ok(checkboxes.every((checkbox) => checkbox.checked));
  assert.ok(view.getByRole("button", { name: "End all and continue" }));
  fireEvent.click(view.getByRole("button", { name: "Clear all" }));
  assert.ok(checkboxes.every((checkbox) => !checkbox.checked));
  fireEvent.click(checkboxes[1]);
  fireEvent.click(checkboxes[3]);
  fireEvent.click(view.getByRole("button", { name: "End 2 and continue" }));
  assert.equal(view.getByRole("button", { name: "Approving device…" }).disabled, true);
  assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, true);
  assert.ok(checkboxes.every((checkbox) => checkbox.disabled));
  assert.deepEqual(JSON.parse(requests("/api/auth/session-limit", "POST")[0][2].body), { sessionIds: ["session-2", "session-4"] });
  await ui.act(async () => finishApproval(Response.json({ ok: true })));
  assert.deepEqual(calls.at(-1), ["assign", destination]);
  assert.equal(consumePostSignInDestination(), "/");
});

test("session summaries retain a region code when a browser locale service cannot name it", async (t) => {
  t.mock.method(Intl.DisplayNames.prototype, "of", () => undefined);
  fixtures.set("GET /api/auth/session-limit", () => Response.json({ sessions: [session(1)] }));
  const view = showSessionLimit();
  await view.findByText(/SG ·/);
  assert.ok(view.getByRole("group", { name: "Active sessions" }));
});

for (const [name, fixture] of [["missing session list", () => Response.json({})], ["invalid JSON", () => new Response("Unavailable")]]) {
  test(`a successful session check with ${name} allows the server to approve without revocations`, async () => {
    fixtures.set("GET /api/auth/session-limit", fixture);
    fixtures.set("POST /api/auth/session-limit", () => new Response(""));
    const view = showSessionLimit();
    await view.findByRole("heading", { name: "A session slot is available" });
    assert.equal(view.queryByRole("checkbox"), null);
    fireEvent.click(view.getByRole("button", { name: "Continue on this device" }));
    await waitFor(() => assert.ok(calls.some(([type]) => type === "assign")));
    assert.deepEqual(JSON.parse(requests("/api/auth/session-limit", "POST")[0][2].body), {});
    assert.deepEqual(calls.at(-1), ["assign", "/"]);
  });
}

for (const action of ["Cancel", "Close sign in", "Escape"]) {
  test(`${action} cancels only the pending device and clears its stored destination`, async () => {
    rememberPostSignInDestination(destination);
    const view = showSessionLimit();
    await view.findByRole("heading", { name: "A session slot is available" });
    if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(view.getByRole("button", { name: action, exact: true }));
    assert.deepEqual(calls.at(-1), ["signout", { callbackUrl: "/" }]);
    assert.equal(consumePostSignInDestination(), "/");
    assert.equal(requests("/api/auth/session-limit", "POST").length, 0);
  });
}

for (const [name, fixture, message] of [
  ["server error", () => Response.json({ error: "Devices unavailable" }, { status: 503 }), "Devices unavailable"],
  ["missing error", () => Response.json({}, { status: 503 }), "Unable to load active devices."],
  ["invalid JSON", () => new Response("Unavailable", { status: 502 }), "Unable to load active devices."],
  ["network error", () => Promise.reject(new Error("Network unavailable")), "Network unavailable"],
  ["non-error failure", () => Promise.reject("unavailable"), "Unable to load active devices."],
]) {
  test(`session loading ${name} blocks approval and leaves cancellation available`, async () => {
    fixtures.set("GET /api/auth/session-limit", fixture);
    const view = showSessionLimit();
    assert.equal((await view.findByRole("alert")).textContent, message);
    assert.equal(view.getByRole("button", { name: "Continue on this device" }).disabled, true);
    assert.equal(view.getByRole("button", { name: "Cancel", exact: true }).disabled, false);
  });
}

for (const [name, fixture, message] of [
  ["server rejection", () => Response.json({ error: "Try again shortly" }, { status: 503 }), "Try again shortly"],
  ["missing error", () => Response.json({}, { status: 503 }), "Unable to approve this device."],
  ["invalid JSON", () => new Response("Unavailable", { status: 502 }), "Unable to approve this device."],
  ["non-error exception", () => Promise.reject("unavailable"), "Unable to approve this device."],
]) {
  test(`device approval ${name} can be retried after a successful session check`, async () => {
    fixtures.set("POST /api/auth/session-limit", fixture);
    const view = showSessionLimit();
    await view.findByRole("heading", { name: "A session slot is available" });
    fireEvent.click(view.getByRole("button", { name: "Continue on this device" }));
    assert.equal((await view.findByRole("alert")).textContent, message);
    assert.equal(view.getByRole("button", { name: "Continue on this device" }).disabled, false);
    fixtures.set("POST /api/auth/session-limit", () => Response.json({ ok: true }));
    fireEvent.click(view.getByRole("button", { name: "Continue on this device" }));
    await waitFor(() => assert.ok(calls.some(([type]) => type === "assign")));
  });
}

for (const reject of [false, true]) {
  test(`session results that ${reject ? "fail" : "succeed"} after unmount never restore a dismissed dialog`, async () => {
    let settle;
    fixtures.set("GET /api/auth/session-limit", () => new Promise((resolve, fail) => { settle = reject ? fail : resolve; }));
    const view = showSessionLimit();
    view.unmount();
    await ui.act(async () => settle(reject ? new Error("Late error") : Response.json({ sessions: [session(1)] })));
    assert.equal(view.queryByRole("dialog"), null);
    assert.equal(calls.some(([type]) => type === "assign"), false);
  });
}

test("OAuth providers keep their identity and save the exact return path before starting sign-in", async () => {
  const providers = Object.fromEntries(["apple", "github", "facebook", "google", "custom", "passkey"].map((id) => [id, { id, name: id, type: "oauth" }]));
  fixtures.set("GET /api/auth/providers", () => Response.json(providers));
  const view = render(h(SignInPanel, { callbackUrl: destination }));
  assert.ok(view.getByText("Loading sign-in options…"));
  await view.findByRole("button", { name: "Continue with google" });
  assert.ok(view.getByRole("heading", { name: "Welcome to Nest" }));
  assert.equal(view.queryByRole("button", { name: "Continue with passkey" }), null);
  for (const id of ["apple", "github", "facebook", "google", "custom"]) {
    fireEvent.click(view.getByRole("button", { name: `Continue with ${id}` }));
    assert.deepEqual(calls.at(-1), ["signin", id, { callbackUrl: destination }]);
    assert.equal(consumePostSignInDestination(), destination);
  }
  for (const name of ["Terms of Service", "Privacy Policy"]) assert.equal(view.getByRole("link", { name }).getAttribute("rel"), "noopener noreferrer");
});

for (const payload of [null, {}]) {
  test(`missing OAuth providers (${JSON.stringify(payload)}) are explained without showing an unusable passkey option`, async (t) => {
    fixtures.set("GET /api/auth/providers", () => Response.json(payload));
    supportPasskeys(t, null);
    const view = render(h(SignInPanel));
    await view.findByText("No auth providers configured.");
    assert.equal(view.queryByRole("button"), null);
  });
}

test("post-sign-in destination helpers are safe during server rendering", () => {
  const original = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(rememberPostSignInDestination(destination), undefined);
    assert.equal(consumePostSignInDestination(), "/");
    assert.equal(clearPostSignInDestination(), undefined);
  } finally {
    globalThis.window = original;
  }
});

for (const [name, fixture, message] of [
  ["database unavailable", () => Response.json({ code: DATABASE_UNAVAILABLE_CODE }, { status: 503 }), DATABASE_UNAVAILABLE_MESSAGE],
  ["database detail", () => Response.json({ code: DATABASE_UNAVAILABLE_CODE, message: "Database waking up" }, { status: 503 }), "Database waking up"],
  ["server error", () => Response.json({ error: "Private failure" }, { status: 500 }), "Unable to load sign-in options right now."],
  ["invalid JSON", () => new Response("Unavailable", { status: 502 }), "Unable to load sign-in options right now."],
  ["network error", () => Promise.reject(new Error("Connection unavailable")), "Connection unavailable"],
  ["non-error exception", () => Promise.reject("unavailable"), "Unable to load sign-in options right now."],
]) {
  test(`provider ${name} is visible without exposing raw server failures`, async (t) => {
    fixtures.set("GET /api/auth/providers", fixture);
    supportPasskeys(t);
    const view = render(h(SignInPanel));
    await view.findByText(message);
    if (message === DATABASE_UNAVAILABLE_MESSAGE) assert.equal(view.queryByRole("button"), null);
  });
}

for (const reject of [false, true]) {
  test(`provider results that ${reject ? "fail" : "succeed"} after unmount do not update a dismissed form`, async () => {
    let settle;
    fixtures.set("GET /api/auth/providers", () => new Promise((resolve, fail) => { settle = reject ? fail : resolve; }));
    const view = render(h(SignInPanel));
    view.unmount();
    await ui.act(async () => settle(reject ? new Error("Late error") : Response.json({})));
    assert.equal(view.queryByText("Loading sign-in options…"), null);
  });
}

test("passkey sign-in exchanges the selected challenge and credential and redirects only after token verification", async (t) => {
  supportPasskeys(t);
  let finish;
  authenticate = () => new Promise((resolve) => { finish = resolve; });
  const view = render(h(SignInPanel, { callbackUrl: destination }));
  fireEvent.click(await view.findByRole("button", { name: "Continue with a passkey" }));
  await waitFor(() => assert.ok(finish));
  assert.equal(view.getByRole("button", { name: "Checking passkey…" }).disabled, true);
  assert.deepEqual(calls.find(([type]) => type === "authenticate"), ["authenticate", { optionsJSON: { challenge: "fixture-options" } }]);
  await ui.act(async () => finish({ id: "fixture-credential", response: { authenticatorData: "fixture-data" } }));
  assert.deepEqual(JSON.parse(requests("/api/passkeys/authenticate/verify", "POST")[0][2].body), { challengeId: "fixture-challenge", response: { id: "fixture-credential", response: { authenticatorData: "fixture-data" } } });
  assert.deepEqual(calls.find(([type]) => type === "signin"), ["signin", "passkey", { loginToken: "fixture-login-token", redirect: false, callbackUrl: destination }]);
  assert.deepEqual(calls.at(-1), ["assign", destination]);
  assert.equal(consumePostSignInDestination(), destination);
});

for (const result of [undefined, {}]) {
  test(`passkey sign-in uses the internal home fallback for an absent redirect (${JSON.stringify(result)})`, async (t) => {
    supportPasskeys(t);
    signIn = async () => result;
    const view = render(h(SignInPanel));
    fireEvent.click(await view.findByRole("button", { name: "Continue with a passkey" }));
    await waitFor(() => assert.ok(calls.some(([type]) => type === "assign")));
    assert.deepEqual(calls.at(-1), ["assign", "/"]);
  });
}

for (const [name, configure, message] of [
  ["options rejection", () => fixtures.set("POST /api/passkeys/authenticate/options", () => Response.json({ error: "Challenge unavailable" }, { status: 503 })), "Challenge unavailable"],
  ["empty options rejection", () => fixtures.set("POST /api/passkeys/authenticate/options", () => Response.json({}, { status: 503 })), "Unable to start passkey sign-in."],
  ["browser cancellation", () => { authenticate = async () => { throw new Error("Authentication cancelled"); }; }, "Authentication cancelled"],
  ["non-error failure", () => { authenticate = async () => { throw "unavailable"; }; }, "Passkey sign-in failed."],
  ["verification rejection", () => fixtures.set("POST /api/passkeys/authenticate/verify", () => Response.json({ error: "Credential rejected" }, { status: 401 })), "Credential rejected"],
  ["missing login token", () => fixtures.set("POST /api/passkeys/authenticate/verify", () => Response.json({})), "Passkey sign-in failed."],
  ["session rejection", () => { signIn = async () => ({ error: "Denied" }); }, "Passkey sign-in failed."],
]) {
  test(`passkey ${name} leaves the user on the form with a retry action`, async (t) => {
    supportPasskeys(t);
    configure();
    const view = render(h(SignInPanel));
    fireEvent.click(await view.findByRole("button", { name: "Continue with a passkey" }));
    await view.findByText(message);
    assert.equal(view.getByRole("button", { name: "Continue with a passkey" }).disabled, false);
    assert.equal(calls.some(([type]) => type === "assign"), false);
  });
}
