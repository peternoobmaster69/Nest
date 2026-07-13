"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  clearInstallPrompt,
  getInstallPrompt,
  hasInstallPrompt,
  subscribeInstallPrompt,
} from "@/lib/install-prompt";

type Passkey = {
  id: string;
  name: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

type PushStatus = {
  configured: boolean;
  publicKey: string;
  subscribed: boolean;
};

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = window.atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function SettingsAppAccess() {
  const queryClient = useQueryClient();
  const installAvailable = useSyncExternalStore(subscribeInstallPrompt, hasInstallPrompt, () => false);
  const [capabilities, setCapabilities] = useState({ passkeys: false, push: false, standalone: false, ios: false });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCapabilities({
      passkeys: "PublicKeyCredential" in window,
      push: "Notification" in window && "serviceWorker" in navigator && "PushManager" in window,
      standalone: isStandalone(),
      ios: /iPad|iPhone|iPod/.test(navigator.userAgent),
    });
  }, []);

  const passkeys = useQuery({
    queryKey: ["settings-passkeys"],
    queryFn: () => jsonRequest<{ passkeys: Passkey[] }>("/api/passkeys"),
  });

  const pushStatus = useQuery({
    queryKey: ["settings-push-status"],
    queryFn: () => jsonRequest<PushStatus>("/api/push-subscriptions"),
  });

  const installApp = useMutation({
    mutationFn: async () => {
      const prompt = getInstallPrompt();
      if (!prompt) throw new Error("Use your browser menu to install Nest on this device.");
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        clearInstallPrompt();
        setCapabilities((current) => ({ ...current, standalone: true }));
      }
      return choice;
    },
    onSuccess: (choice) => setMessage(choice.outcome === "accepted" ? "Nest was installed." : "Installation was cancelled."),
  });

  const addPasskey = useMutation({
    mutationFn: async () => {
      const start = await jsonRequest<{ challengeId: string; options: RegistrationOptions }>("/api/passkeys/register/options", {
        method: "POST",
      });
      const response = await startRegistration({ optionsJSON: start.options });
      await jsonRequest("/api/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: start.challengeId, name: "Nest passkey", response }),
      });
    },
    onSuccess: async () => {
      setMessage("Passkey added. You can now use it to sign in.");
      await queryClient.invalidateQueries({ queryKey: ["settings-passkeys"] });
    },
  });

  const removePasskey = useMutation({
    mutationFn: (id: string) => jsonRequest("/api/passkeys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
    onSuccess: async () => {
      setMessage("Passkey removed.");
      await queryClient.invalidateQueries({ queryKey: ["settings-passkeys"] });
    },
  });

  const enableNotifications = useMutation({
    mutationFn: async () => {
      const status = pushStatus.data;
      if (!status?.configured || !status.publicKey) throw new Error("Push notifications are not configured for this deployment.");
      if (!capabilities.push) throw new Error("This browser does not support push notifications.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.getRegistration("/") ?? await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(status.publicKey),
      });
      await jsonRequest("/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    },
    onSuccess: async () => {
      setMessage("Notifications enabled.");
      await queryClient.invalidateQueries({ queryKey: ["settings-push-status"] });
    },
  });

  const disableNotifications = useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      await jsonRequest("/api/push-subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription ? { endpoint: subscription.endpoint } : {}),
      });
      await subscription?.unsubscribe();
    },
    onSuccess: async () => {
      setMessage("Notifications disabled.");
      await queryClient.invalidateQueries({ queryKey: ["settings-push-status"] });
    },
  });

  const installDescription = capabilities.standalone
    ? "Nest is installed on this device."
    : capabilities.ios
      ? "In Safari, use Share, then Add to Home Screen."
      : installAvailable
        ? "Install Nest for faster access from your home screen."
        : "Your browser will enable installation when the app is eligible.";

  return (
    <>
      <div className="card settings-card-block settings-app-access-card">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title">Install Nest</div>
            <div className="settings-section-copy">{installDescription}</div>
          </div>
          {capabilities.standalone ? (
            <span className="settings-status-pill is-enabled">Installed</span>
          ) : capabilities.ios ? (
            <span className="settings-status-pill">Browser menu</span>
          ) : (
            <button className="btn btn-primary btn-xs" type="button" onClick={() => installApp.mutate()} disabled={!installAvailable || installApp.isPending}>
              {installApp.isPending ? "Installing..." : "Install"}
            </button>
          )}
        </div>

        <div className="settings-row settings-row-spaced">
          <div className="settings-item-copy">
            <div className="settings-section-title">Notifications</div>
            <div className="settings-section-copy">
              {!pushStatus.data?.configured
                ? "Notification delivery has not been configured for this deployment."
                : "Receive payment, receivable, invitation, and background-task alerts."}
            </div>
          </div>
          {pushStatus.data?.subscribed ? (
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => disableNotifications.mutate()} disabled={disableNotifications.isPending}>
              {disableNotifications.isPending ? "Disabling..." : "Disable"}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-xs"
              type="button"
              onClick={() => enableNotifications.mutate()}
              disabled={!capabilities.push || !pushStatus.data?.configured || enableNotifications.isPending}
            >
              {enableNotifications.isPending ? "Enabling..." : "Enable"}
            </button>
          )}
        </div>
      </div>

      <div className="card settings-card-block settings-passkeys-card">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title">Passkeys</div>
            <div className="settings-section-copy">Sign in securely with Face ID, Touch ID, Windows Hello, or a security key.</div>
          </div>
          <button className="btn btn-primary btn-xs" type="button" onClick={() => addPasskey.mutate()} disabled={!capabilities.passkeys || addPasskey.isPending}>
            {addPasskey.isPending ? "Adding..." : "Add Passkey"}
          </button>
        </div>

        {passkeys.isLoading ? <div className="settings-muted-message settings-message-spaced">Loading passkeys...</div> : null}
        {passkeys.isError ? <div className="settings-message settings-message-spaced">Passkeys could not be loaded.</div> : null}
        {passkeys.data?.passkeys.length ? (
          <div className="settings-passkey-list">
            {passkeys.data.passkeys.map((passkey) => (
              <div className="settings-passkey-item" key={passkey.id}>
                <div>
                  <strong>{passkey.name || "Passkey"}</strong>
                  <span>
                    Added {new Date(passkey.createdAt).toLocaleDateString("en-SG")}
                    {passkey.backedUp ? " · Synced" : ""}
                  </span>
                </div>
                <button
                  className="btn-icon"
                  type="button"
                  onClick={() => removePasskey.mutate(passkey.id)}
                  disabled={removePasskey.isPending}
                  aria-label={`Remove ${passkey.name || "passkey"}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {message ? <div className="settings-access-message" role="status">{message}</div> : null}
    </>
  );
}
