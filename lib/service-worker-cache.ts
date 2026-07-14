export async function purgePrivateServiceWorkerCaches() {
  if (typeof window === "undefined") return;

  if ("caches" in window) {
    const keys = await window.caches.keys();
    await Promise.all(keys.filter((key) => key.endsWith("-read")).map((key) => window.caches.delete(key)));
  }

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    registration?.active?.postMessage({ type: "PURGE_PRIVATE_CACHES" });
  }
}
