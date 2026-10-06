import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { Window } from "happy-dom";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { proxy } = require("../proxy.ts");
const { staticPageScriptIntegrity } = require("../lib/static-page-csp.ts");

for (const page of ["offline", "style-guide"]) {
  test(`${page} loads only its integrity-verified script under the production CSP`, async () => {
    const script = await readFile(new URL(`../public/${page}.js`, import.meta.url));
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), "utf8");
    const digest = `sha256-${createHash("sha256").update(script).digest("base64")}`;
    assert.equal(staticPageScriptIntegrity(`/${page}.html`), digest);
    assert.ok(html.includes(`<script src="/${page}.js" integrity="${digest}" defer></script>`));
    assert.doesNotMatch(html, /<script\s*>|\son(?:click|change|load)=/i);
    const response = proxy(new NextRequest(`https://nest.example.test/${page}.html`));
    const csp = response.headers.get("content-security-policy");
    const scriptPolicy = csp.split(";").find((part) => part.trim().startsWith("script-src"));
    assert.ok(scriptPolicy.includes(`'${digest}'`));
    assert.ok(scriptPolicy.includes("'strict-dynamic'"));
    assert.ok(!scriptPolicy.includes("'unsafe-inline'"));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });
}

test("static script trust is limited to the exact public pages", () => {
  for (const pathname of ["/", "/api/context", "/w/workspace", "/offline.html/extra", "__proto__"]) {
    assert.equal(staticPageScriptIntegrity(pathname), undefined);
  }
});

test("the style guide exposes working light and dark controls without inline event handlers", async () => {
  const source = await readFile(new URL("../public/style-guide.js", import.meta.url), "utf8");
  for (const initial of ["light", "dark"]) {
    const window = new Window();
    window.document.documentElement.dataset.theme = initial;
    window.document.body.innerHTML = '<button data-theme-option="light">Light</button><button data-theme-option="dark">Dark</button>';
    try {
      vm.runInNewContext(source, { document: window.document });
      const [light, dark] = window.document.querySelectorAll("button");
      assert.equal(light.getAttribute("aria-pressed"), String(initial === "light"));
      dark.click();
      assert.equal(window.document.documentElement.dataset.theme, "dark");
      assert.equal(dark.getAttribute("aria-pressed"), "true");
      assert.ok(dark.classList.contains("active"));
      light.click();
      assert.equal(window.document.documentElement.dataset.theme, "light");
      assert.equal(dark.getAttribute("aria-pressed"), "false");
      assert.ok(!dark.classList.contains("active"));
    } finally { window.close(); }
  }
});

test("offline actions navigate back or retry without looping on the public offline page", async () => {
  const source = await readFile(new URL("../public/offline.js", import.meta.url), "utf8");
  for (const pathname of ["/offline.html", "/w/workspace/transactions"]) {
    for (const onLine of [false, true]) {
      const window = new Window();
      window.document.body.innerHTML = '<p id="status">Waiting for a connection…</p><button id="back">Back</button><button id="retry">Retry</button>';
      const navigation = [];
      const history = { length: 1, back: () => navigation.push("back") };
      const navigator = { onLine };
      try {
        vm.runInNewContext(source, {
          document: window.document,
          navigator,
          URL,
          window: {
            location: { pathname, href: `https://nest.example.test${pathname}`, assign: (href) => navigation.push(href), reload: () => navigation.push("reload") },
            history,
            addEventListener: window.addEventListener.bind(window),
          },
        });
        const status = window.document.getElementById("status");
        assert.deepEqual(navigation, onLine && pathname !== "/offline.html" ? ["reload"] : []);
        window.document.getElementById("back").click();
        assert.match(status.textContent, /No earlier screen/);
        history.length = 2;
        window.document.getElementById("back").click();
        assert.equal(navigation.at(-1), "back");
        window.document.getElementById("retry").click();
        assert.equal(navigation.at(-1), pathname === "/offline.html" ? "https://nest.example.test/" : "reload");
        assert.match(status.textContent, onLine ? /Checking connection/ : /Still offline/);
        window.dispatchEvent(new window.Event("online"));
        assert.match(status.textContent, /Connection restored/);
      } finally { window.close(); }
    }
  }
});
