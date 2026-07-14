const VERSION = "nest-v4";
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

const APP_SHELL = [
  "/offline",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
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
  if (event.data?.type !== "PURGE_PRIVATE_CACHES") return;
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.endsWith("-read")).map((key) => caches.delete(key)),
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
  if (self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1") return;

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
      fetch(request).catch(async () => (await caches.open(SHELL_CACHE)).match("/offline") || new Response("Offline", { status: 503 })),
    );
    return;
  }

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
