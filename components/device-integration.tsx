"use client";

import { Download, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { notifyToast } from "@/components/toast-provider";
import { clearInstallPrompt, rememberInstallPrompt, type InstallPromptEvent } from "@/lib/install-prompt";
import { Button } from "@/components/ui/button";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function DeviceIntegration() {
  const [offline, setOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(true);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }, []);

  useEffect(() => {
    const syncNetworkState = () => {
      const isOffline = !navigator.onLine;
      setOffline(isOffline);
      document.documentElement.dataset.networkState = isOffline ? "offline" : "online";
    };
    syncNetworkState();
    window.addEventListener("online", syncNetworkState);
    window.addEventListener("offline", syncNetworkState);
    return () => {
      window.removeEventListener("online", syncNetworkState);
      window.removeEventListener("offline", syncNetworkState);
      delete document.documentElement.dataset.networkState;
    };
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (!navigator.onLine && method !== "GET" && method !== "HEAD") {
        const message = "You are offline. This change was not submitted or queued.";
        notifyToast(message, "error");
        return Promise.reject(new Error(message));
      }
      return originalFetch(input, init);
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    const keepCurrentScreenAvailable = (event: MouseEvent) => {
      if (navigator.onLine || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;

      event.preventDefault();
      notifyToast("You are offline. This screen is still available; reconnect before opening another page.", "error");
    };

    document.addEventListener("click", keepCurrentScreenAvailable, true);
    return () => document.removeEventListener("click", keepCurrentScreenAvailable, true);
  }, []);

  useEffect(() => {
    setInstallDismissed(window.sessionStorage.getItem("nest:install-dismissed") === "true" || isStandalone());
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      const prompt = event as InstallPromptEvent;
      setInstallPrompt(prompt);
      rememberInstallPrompt(prompt);
      if (!isStandalone() && window.sessionStorage.getItem("nest:install-dismissed") !== "true") {
        setInstallDismissed(false);
      }
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  const dismissInstall = () => {
    window.sessionStorage.setItem("nest:install-dismissed", "true");
    setInstallDismissed(true);
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    clearInstallPrompt();
    dismissInstall();
  };

  return (
    <>
      {offline ? (
        <div className="offline-banner" role="status" aria-live="polite">
          <WifiOff size={16} aria-hidden="true" /> Offline: viewing this screen only. Changes and navigation are paused.
        </div>
      ) : null}
      {installPrompt && !installDismissed ? (
        <aside className="install-prompt" aria-label="Install Nest">
          <Download size={20} aria-hidden="true" />
          <div><strong>Install Nest</strong><span>Open faster from your home screen.</span></div>
          <Button className="btn btn-primary btn-sm" type="button" onClick={install}>Install</Button>
          <Button className="modal-close" type="button" onClick={dismissInstall} aria-label="Dismiss install prompt"><X size={18} /></Button>
        </aside>
      ) : null}
    </>
  );
}
