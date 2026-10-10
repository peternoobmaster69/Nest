import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach, mock } from "node:test";

const require = createRequire(import.meta.url);
let session;
mock.module("../lib/server-session.ts", { namedExports: { getDatabaseReadyServerSession: async () => session } });
mock.module("next/navigation", { namedExports: {
  redirect: location => { throw Object.assign(new Error("Redirect"), { location }); },
  useRouter: () => ({ push() {}, replace() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
} });
const { default: Home, generateMetadata } = require("../app/page.tsx");
const { LandingSignInDialog } = require("../components/landing-signin-dialog.tsx");
const { isValidElement } = require("react");
beforeEach(() => { session = null; });

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

test("anonymous visitors receive the public landing page with stable, unique heading and illustration keys", async () => {
  const page = await Home({});
  assert.equal(page.type, "main");
  const elements = nodes(page);
  assert.ok(!elements.some(element => element.type === LandingSignInDialog));
  for (const [id, expected] of [
    ["reconcile-title", "A discrepancy is a useful signal—not a mystery."],
    ["cta-title", "One home for the money you have, owe, expect, and invest."],
  ]) {
    const heading = elements.find(element => element.props.id === id);
    assert.equal(heading.props.children.map(word => word.props.children[0]).join(" "), expected);
    const keys = heading.props.children.map(word => word.key);
    assert.equal(new Set(keys).size, keys.length);
  }
  for (const bars of elements.filter(element => element.props.className === "lp-lens-bars")) {
    const keys = bars.props.children.map(bar => bar.key);
    assert.equal(new Set(keys).size, keys.length);
  }
  const links = elements.filter(element => element.props.href);
  for (const href of ["/login", "/privacy-policy", "/terms-of-service"]) assert.ok(links.some(link => link.props.href === href));
});

test("signed-in visitors enter their workspace instead of rendering the landing page", async () => {
  session = { user: { id: "owner" } };
  await assert.rejects(Home({}), error => error.location === "/entry");
});

for (const [params, currentSession, callbackUrl, message, limited] of [
  [{ login: "1", callbackUrl: "/w/household/settings?tab=data" }, null, "/w/household/settings?tab=data", null, undefined],
  [{ error: "AccessDenied", callbackUrl: "https://untrusted.example" }, null, "/", "Access was denied for this sign-in attempt.", undefined],
  [{}, { sessionLimitRequired: true }, "/", null, true],
]) {
  test(`sign-in state carries a safe return path and account guidance (${JSON.stringify(params)})`, async () => {
    session = currentSession;
    const page = await Home({ searchParams: Promise.resolve(params) });
    const dialog = nodes(page).find(element => element.type === LandingSignInDialog);
    assert.ok(dialog);
    assert.equal(dialog.props.callbackUrl, callbackUrl);
    assert.equal(dialog.props.serviceMessage, message);
    assert.equal(dialog.props.sessionLimitRequired, limited);
  });
}

test("a session without a signed-in user or a session-limit prompt keeps sign-in optional", async () => {
  session = {};
  const page = await Home({ searchParams: Promise.resolve({ login: "0" }) });
  assert.ok(!nodes(page).some(element => element.type === LandingSignInDialog));
});

test("public metadata stays canonical while every sign-in query is excluded from indexing", async () => {
  const metadata = await generateMetadata({});
  assert.match(metadata.alternates.canonical, /\/$/);
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  for (const params of [{ login: "1" }, { error: "AccessDenied" }, { callbackUrl: "/entry" }]) {
    const signIn = await generateMetadata({ searchParams: Promise.resolve(params) });
    assert.deepEqual(signIn.robots, { index: false, follow: false });
    assert.equal(signIn.alternates.canonical, metadata.alternates.canonical);
  }
});
