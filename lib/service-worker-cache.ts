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

export type OfflineStorageSummary = {
  supported: boolean;
  cacheCount: number;
  entryCount: number;
};

export async function getOfflineStorageSummary(): Promise<OfflineStorageSummary> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return { supported: false, cacheCount: 0, entryCount: 0 };
  }
  const cacheNames = (await window.caches.keys()).filter((name) => name.startsWith("nest-"));
  const entryCounts = await Promise.all(cacheNames.map(async (name) => (await window.caches.open(name)).keys()));
  return {
    supported: true,
    cacheCount: cacheNames.length,
    entryCount: entryCounts.reduce((total, entries) => total + entries.length, 0),
  };
}

export async function clearNestOfflineStorage() {
  if (typeof window === "undefined") return;
  if ("caches" in window) {
    const keys = await window.caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("nest-")).map((key) => window.caches.delete(key)));
  }
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/");
    registration?.active?.postMessage({ type: "PURGE_ALL_CACHES" });
  }
}
