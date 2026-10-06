const VERSION = "nest-v8";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_FALLBACK = "/offline.html";

const APP_SHELL = [
  OFFLINE_FALLBACK,
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.svg",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);

    // The fallback must always be available. Optional install assets are cached
    // independently so one unavailable icon cannot make the whole worker fail.
    await cache.add(new Request(OFFLINE_FALLBACK, { cache: "reload" }));
    await Promise.allSettled(
      APP_SHELL
        .filter((asset) => asset !== OFFLINE_FALLBACK)
        .map((asset) => cache.add(new Request(asset, { cache: "reload" }))),
    );
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.endsWith("-read") || !key.startsWith(VERSION))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.origin !== self.location.origin) return;
  if (event.data?.type !== "PURGE_PRIVATE_CACHES" && event.data?.type !== "PURGE_ALL_CACHES") return;
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => event.data.type === "PURGE_ALL_CACHES" ? key.startsWith("nest-") : key.endsWith("-read")).map((key) => caches.delete(key)),
    )),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isLocalDevelopment = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

  if (request.method !== "GET") {
    event.respondWith(
      fetch(request)
        .catch(() => new Response(JSON.stringify({
          error: "offline",
          message: "This change was not submitted because the device is offline.",
          queued: false,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        })),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match(OFFLINE_FALLBACK);
        return fallback || new Response(
          "Nest is offline. Reconnect and try again.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      }),
    );
    return;
  }

  // Avoid retaining constantly changing development bundles while still making
  // the navigation fallback testable on localhost.
  if (isLocalDevelopment) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".svg")) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
  }
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {};
  const title = payload.title || "Nest";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.message || "You have a new notification.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "nest-notification",
    data: { href: payload.href || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = new URL(event.notification.data?.href || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const existing = clients.find((client) => client.url === href);
      if (existing) return existing.focus();
      return self.clients.openWindow(href);
    }),
  );
});
