import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { Window } from "happy-dom";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const { proxy } = require("../proxy.ts");
const { staticPageScriptIntegrity } = require("../lib/static-page-csp.ts");

async function runStaticScripts(globals, page) {
  const context = vm.createContext(globals);
  const scripts = ["static-page-messages", "static-page-copy"];
  if (page) scripts.push(page);
  for (const name of scripts) {
    const filename = fileURLToPath(new URL(`../public/${name}.js`, import.meta.url));
    vm.runInContext(await readFile(filename, "utf8"), context, { filename });
  }
  return context;
}

for (const page of ["offline", "style-guide"]) {
  test(`${page} loads its ordered, integrity-verified scripts under the production CSP`, async () => {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), "utf8");
    const expected = [];
    for (const name of ["static-page-messages", "static-page-copy", page]) {
      const script = await readFile(new URL(`../public/${name}.js`, import.meta.url));
      const digest = `sha256-${createHash("sha256").update(script).digest("base64")}`;
      expected.push({ name, digest });
    }
    assert.deepEqual(staticPageScriptIntegrity(`/${page}.html`), expected.map(({ digest }) => digest));
    const tags = [...html.matchAll(/<script[^>]*><\/script>/g)].map(([tag]) => tag);
    assert.deepEqual(tags, expected.map(({ name, digest }) => `<script src="/${name}.js" integrity="${digest}" defer></script>`));
    assert.doesNotMatch(html, /<script\s*>|\son(?:click|change|load)=/i);
    const response = proxy(new NextRequest(`https://nest.example.test/${page}.html`));
    const csp = response.headers.get("content-security-policy");
    const scriptPolicy = csp.split(";").find((part) => part.trim().startsWith("script-src"));
    for (const { digest } of expected) assert.ok(scriptPolicy.includes(`'${digest}'`));
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
  for (const initial of ["light", "dark"]) {
    const window = new Window();
    window.document.documentElement.dataset.theme = initial;
    window.document.body.innerHTML = '<button data-theme-option="light">Light</button><button data-theme-option="dark">Dark</button>';
    try {
      await runStaticScripts({ document: window.document }, "style-guide");
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
  for (const pathname of ["/offline.html", "/w/workspace/transactions"]) {
    for (const onLine of [false, true]) {
      const window = new Window();
      window.document.body.innerHTML = '<p id="status">Waiting for a connection…</p><button id="back">Back</button><button id="retry">Retry</button>';
      const navigation = [];
      const history = { length: 1, back: () => navigation.push("back") };
      const navigator = { onLine };
      try {
        await runStaticScripts({
          document: window.document,
          navigator,
          URL,
          window: {
            location: { pathname, href: `https://nest.example.test${pathname}`, assign: (href) => navigation.push(href), reload: () => navigation.push("reload") },
            history,
            addEventListener: window.addEventListener.bind(window),
          },
        }, "offline");
        const status = window.document.getElementById("status");
        assert.deepEqual(navigation, [], "loading an offline fallback must not automatically reload an unreachable origin");
        assert.match(status.textContent, onLine ? /Connection available/ : /Waiting for a connection/);
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

for (const page of ["style-guide", "offline"]) {
  test(`${page} resolves its complete text bundle and preserves accessible names`, async () => {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), "utf8");
    const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
    try {
      window.document.write(html);
      const { renderStaticPageCopy } = await runStaticScripts({ document: window.document });
      renderStaticPageCopy(window.document);
      assert.doesNotMatch(window.document.body.textContent, /\{\{/);
      for (const element of window.document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
        for (const name of ["aria-label", "title", "placeholder", "alt"]) assert.doesNotMatch(element.getAttribute(name) ?? "", /\{\{/);
      }
      if (page === "style-guide") {
        assert.equal(window.document.querySelector(".sg-logo-name").textContent, "Nest");
        assert.equal(window.document.querySelectorAll(".sg-logo-mark svg").length, 1);
        for (const id of ["guide-account-name", "guide-amount", "guide-category", "guide-email", "guide-search", "guide-notes"]) {
          const input = window.document.getElementById(id);
          assert.equal(input.labels.length, 1);
          assert.ok(input.labels[0].textContent.trim());
        }
        assert.equal(window.document.getElementById("guide-account-name").placeholder, "e.g. Emergency Fund");
        assert.equal(window.document.getElementById("guide-email").getAttribute("aria-invalid"), "true");
      } else {
        assert.equal(window.document.querySelector("h1").textContent, "You’re offline");
        assert.equal(window.document.getElementById("status").tagName, "OUTPUT");
        assert.equal(window.document.getElementById("back").textContent, "Go back");
        assert.equal(window.document.getElementById("retry").textContent, "Try again");
      }
    } finally { window.close(); }
  });
}

test("static resource expansion treats translated content as text and rejects missing keys", async () => {
  const window = new Window();
  try {
    const { renderStaticPageCopy, staticPageText } = await runStaticScripts({ document: window.document });
    window.document.body.innerHTML = '<style>/* {{ignored}} */</style><p>{{label}}</p><input aria-label="{{label}}" title="{{label}}" placeholder="{{label}}"><img alt="{{label}}">';
    const message = '<b>Use & preserve text</b>';
    renderStaticPageCopy(window.document, { label: message });
    assert.equal(window.document.querySelector("p").textContent, message);
    assert.equal(window.document.querySelector("b"), null);
    assert.equal(window.document.querySelector("input").getAttribute("aria-label"), message);
    assert.match(window.document.querySelector("style").textContent, /\{\{ignored}}/);
    for (const messages of [{}, { label: 12 }, Object.create({ label: "Inherited" })]) {
      assert.throws(() => staticPageText("label", messages), /Missing static-page message/);
    }
    window.document.querySelector("p").textContent = "{{missing}}";
    assert.throws(() => renderStaticPageCopy(window.document, {}), /missing/);
  } finally { window.close(); }
});
