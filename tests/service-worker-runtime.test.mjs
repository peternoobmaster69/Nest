import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

const filename = path.resolve("public/sw.js");
const source = await readFile(filename, "utf8");

function worker(host = "https://save.htet.info") {
  const handlers = new Map();
  const stores = new Map();
  const notifications = [];
  const opened = [];
  const clients = [];
  let fetchImpl = async () => new Response("network");
  const key = (request) => new URL(typeof request === "string" ? request : request.url, host).href;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async add(request) { entries.set(key(request), new Response("shell")); },
        async put(request, response) { entries.set(key(request), response); },
        async match(request) { return entries.get(key(request))?.clone(); },
      };
    },
    async match(request) {
      for (const entries of stores.values()) {
        const response = entries.get(key(request));
        if (response) return response.clone();
      }
    },
  };
  const self = {
    location: new URL(host),
    addEventListener(type, callback) { handlers.set(type, callback); },
    skipWaitingCalls: 0,
    skipWaiting() { this.skipWaitingCalls += 1; },
    registration: { async showNotification(title, options) { notifications.push({ title, ...options }); } },
    clients: {
      claimed: 0,
      async claim() { this.claimed += 1; },
      async matchAll() { return clients; },
      async openWindow(href) { opened.push(href); },
    },
  };
  class WorkerRequest extends Request {
    constructor(input, options) { super(new URL(input, host), options); }
  }
  vm.runInNewContext(source, { self, caches, URL, Request: WorkerRequest, Response, fetch: (request) => fetchImpl(request) }, { filename });
  return {
    caches, self, notifications, opened, clients,
    fetchWith(implementation) { fetchImpl = implementation; },
    async dispatch(type, event = {}) {
      const work = [];
      let response;
      handlers.get(type)({ ...event, waitUntil(promise) { work.push(promise); }, respondWith(promise) { response = promise; } });
      await Promise.all(work);
      return response;
    },
  };
}

test("worker install prepares the offline shell and activation purges obsolete private caches", async () => {
  const app = worker();
  await app.caches.open("nest-v7-static");
  await app.caches.open("nest-v8-read");
  await app.caches.open("nest-v8-static");
  await app.dispatch("install");
  assert.equal(app.self.skipWaitingCalls, 1);
  assert.equal(await (await app.caches.match("/offline.html")).text(), "shell");
  await app.dispatch("activate");
  assert.deepEqual((await app.caches.keys()).sort(), ["nest-v8-shell", "nest-v8-static"]);
  assert.equal(app.self.clients.claimed, 1);
});

test("cache purge messages require our origin and an explicitly supported operation", async () => {
  const app = worker();
  for (const name of ["nest-v8-read", "nest-v8-shell", "unrelated"]) await app.caches.open(name);
  await app.dispatch("message", { origin: "https://untrusted.test", data: { type: "PURGE_ALL_CACHES" } });
  await app.dispatch("message", { origin: app.self.location.origin });
  await app.dispatch("message", { origin: app.self.location.origin, data: { type: "UNKNOWN" } });
  assert.equal((await app.caches.keys()).length, 3);
  await app.dispatch("message", { origin: app.self.location.origin, data: { type: "PURGE_PRIVATE_CACHES" } });
  assert.deepEqual(await app.caches.keys(), ["nest-v8-shell", "unrelated"]);
  await app.dispatch("message", { origin: app.self.location.origin, data: { type: "PURGE_ALL_CACHES" } });
  assert.deepEqual(await app.caches.keys(), ["unrelated"]);
});

test("the worker never caches cross-origin requests or private application reads", async () => {
  const app = worker();
  for (const url of ["https://other.test/icon.svg", "https://save.htet.info/api/context"]) {
    assert.equal(await app.dispatch("fetch", { request: new Request(url) }), undefined);
  }
  assert.deepEqual(await app.caches.keys(), []);
});

test("mutations succeed online and explicitly fail offline without queuing finance changes", async () => {
  const app = worker();
  const request = new Request("https://save.htet.info/api/transactions", { method: "POST" });
  assert.equal(await (await app.dispatch("fetch", { request })).text(), "network");
  app.fetchWith(async () => { throw new Error("offline"); });
  const response = await app.dispatch("fetch", { request });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).queued, false);
  assert.deepEqual(await app.caches.keys(), []);
});

test("navigation uses the network, then the offline page, then a readable unavailable response", async () => {
  const app = worker();
  const request = { url: "https://save.htet.info/dashboard", method: "GET", mode: "navigate" };
  assert.equal(await (await app.dispatch("fetch", { request })).text(), "network");
  app.fetchWith(async () => { throw new Error("offline"); });
  const unavailable = await app.dispatch("fetch", { request });
  assert.equal(unavailable.status, 503);
  assert.match(await unavailable.text(), /Nest is offline/);
  await app.dispatch("install");
  assert.equal(await (await app.dispatch("fetch", { request })).text(), "shell");
});

test("static assets use network-first caching, retain successful fallbacks, and reject missing assets", async () => {
  const app = worker();
  for (const pathname of ["/_next/static/main.js", "/icons/icon-192.png", "/icon.svg"]) {
    const request = new Request(`https://save.htet.info${pathname}`);
    app.fetchWith(async () => new Response("fresh"));
    assert.equal(await (await app.dispatch("fetch", { request })).text(), "fresh");
    app.fetchWith(async () => { throw new Error("offline"); });
    assert.equal(await (await app.dispatch("fetch", { request })).text(), "fresh");
  }
  const missing = new Request("https://save.htet.info/missing.svg");
  await assert.rejects(app.dispatch("fetch", { request: missing }), /offline/);
  app.fetchWith(async () => new Response("not found", { status: 404 }));
  assert.equal((await app.dispatch("fetch", { request: missing })).status, 404);
  assert.equal(await (await app.caches.open("nest-v8-static")).match(missing), undefined);
});

test("local development bypasses static caching on both supported loopback hostnames", async () => {
  for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100"]) {
    const app = worker(origin);
    assert.equal(await app.dispatch("fetch", { request: new Request(`${origin}/_next/static/main.js`) }), undefined);
    assert.deepEqual(await app.caches.keys(), []);
  }
});

test("push notifications supply defaults and notification clicks focus or open the destination", async () => {
  const app = worker();
  await app.dispatch("push");
  assert.equal(app.notifications[0].title, "Nest");
  assert.equal(app.notifications[0].body, "You have a new notification.");
  await app.dispatch("push", { data: { json: () => ({ title: "Payment due", message: "Check your card", tag: "due", href: "/cards" }) } });
  assert.equal(app.notifications[1].tag, "due");
  assert.equal(app.notifications[1].data.href, "/cards");
  let closed = 0;
  let focused = 0;
  const notification = { close() { closed += 1; }, data: { href: "/cards" } };
  app.clients.push({ url: "https://save.htet.info/cards", focus() { focused += 1; } });
  await app.dispatch("notificationclick", { notification });
  assert.equal(focused, 1);
  assert.deepEqual(app.opened, []);
  await app.dispatch("notificationclick", { notification: { close() { closed += 1; } } });
  assert.deepEqual(app.opened, ["https://save.htet.info/"]);
  assert.equal(closed, 2);
});
