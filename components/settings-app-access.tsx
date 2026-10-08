"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  clearInstallPrompt,
  getInstallPrompt,
  hasInstallPrompt,
  subscribeInstallPrompt,
} from "@/lib/install-prompt";
import { ActionableAuthenticationMessage } from "@/components/reauthentication-message";
import { describeClientDevice } from "@/lib/session-device";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { SettingsAppIcon } from "@/components/settings-app-icon";
import { LinkedAccountSettings } from "@/components/settings/linked-account-settings";
import { getBrowserPushSubscription, preparePushSubscription } from "@/lib/browser-notifications";

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
  subscriptions: Array<{
    id: string;
    provider: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

type LoginSession = {
  sessionId: string;
  provider: string | null;
  deviceName: string;
  ipAddress: string | null;
  countryCode: string | null;
  signedInAt: string;
  lastSeenAt: string;
  current: boolean;
};

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function suggestedPasskeyName() {
  return describeClientDevice(
    navigator.userAgent,
    navigator.maxTouchPoints,
    window.screen.width,
    window.screen.height,
  );
}

function passkeyMetadata(passkey: Passkey) {
  const kind = passkey.backedUp || passkey.deviceType === "multiDevice" ? "Synced passkey" : "Device-bound passkey";
  const added = new Date(passkey.createdAt).toLocaleDateString("en-SG");
  const lastUsed = passkey.lastUsedAt ? new Date(passkey.lastUsedAt).toLocaleDateString("en-SG") : null;
  const usage = lastUsed ? `Last used ${lastUsed}` : "Not used yet";
  return `${kind} · Added ${added} · ${usage}`;
}

function loginSessionLocation(session: LoginSession) {
  let country = session.countryCode ?? "Country unavailable";
  if (session.countryCode) {
    try {
      country = new Intl.DisplayNames(["en"], { type: "region" }).of(session.countryCode) ?? session.countryCode;
    } catch {
      country = session.countryCode;
    }
  }
  return `${country} · ${session.ipAddress ?? "IP unavailable"}`;
}

function loginSessionDetails(session: LoginSession) {
  const provider = session.provider
    ? `${session.provider.charAt(0).toUpperCase()}${session.provider.slice(1)}`
    : "Sign-in provider unavailable";
  const lastSeenAt = new Date(session.lastSeenAt).toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${provider} · Last active ${lastSeenAt}`;
}

type AccessMessage = (message: string | null) => void;

function installDescriptionFor(standalone: boolean, ios: boolean, available: boolean) {
  if (standalone) return "Nest is installed on this device.";
  if (ios) return "In Safari, use Share, then Add to Home Screen.";
  return available ? "Install Nest for faster access from your home screen." : "Your browser will enable installation when the app is eligible.";
}

function InstallAction({ standalone, ios, available, pending, onInstall }: Readonly<{
  standalone: boolean; ios: boolean; available: boolean; pending: boolean; onInstall: () => void;
}>) {
  if (standalone) return <span className="settings-status-pill is-enabled">Installed</span>;
  if (ios) return <span className="settings-status-pill">Browser menu</span>;
  return <Button className="btn btn-primary btn-xs" type="button" onClick={onInstall} disabled={!available || pending}>
    {pending ? "Installing..." : "Install"}
  </Button>;
}

export function SettingsAppAccess() {
  const installAvailable = useSyncExternalStore(subscribeInstallPrompt, hasInstallPrompt, () => false);
  const [capabilities, setCapabilities] = useState({ passkeys: false, push: false, standalone: false, ios: false });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCapabilities({
      passkeys: "PublicKeyCredential" in window,
      push: "Notification" in window && "serviceWorker" in navigator && "PushManager" in window,
      standalone: isStandalone(),
      ios: /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    });
  }, []);

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
    onError: (error) => setMessage(error instanceof Error ? error.message : "Nest could not be installed."),
  });

  const installDescription = installDescriptionFor(capabilities.standalone, capabilities.ios, installAvailable);
  return <>
      <div className="card settings-card-block settings-app-access-card">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title">Install Nest</div>
            <div className="settings-section-copy">{installDescription}</div>
          </div>
          <InstallAction standalone={capabilities.standalone} ios={capabilities.ios} available={installAvailable} pending={installApp.isPending} onInstall={() => installApp.mutate()} />
        </div>

        <NotificationSettings supported={capabilities.push} onMessage={setMessage} />
      </div>
      <SettingsAppIcon />
      <PasskeySettings supported={capabilities.passkeys} onMessage={setMessage} />
      <LoginSessionSettings onMessage={setMessage} />
      <LinkedAccountSettings />
      <ActionableAuthenticationMessage message={message} className="settings-access-message" />
    </>;
}

function PasskeySettings({ supported, onMessage }: Readonly<{ supported: boolean; onMessage: AccessMessage }>) {
  const queryClient = useQueryClient();
  const [isNamingPasskey, setIsNamingPasskey] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");

  const passkeys = useQuery({
    queryKey: queryKeys.key(["settings-passkeys"]),
    queryFn: () => jsonRequest<{ passkeys: Passkey[] }>("/api/passkeys"),
  });

  const addPasskey = useMutation({
    mutationFn: async (name: string) => {
      const start = await jsonRequest<{ challengeId: string; options: RegistrationOptions }>("/api/passkeys/register/options", {
        method: "POST",
      });
      const response = await startRegistration({ optionsJSON: start.options });
      await jsonRequest("/api/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: start.challengeId, name: name.trim(), response }),
      });
    },
    onSuccess: async () => {
      onMessage("Passkey added. You can now use it to sign in.");
      setIsNamingPasskey(false);
      setNewPasskeyName("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-passkeys"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "Passkey could not be added."),
  });

  const renamePasskey = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => jsonRequest("/api/passkeys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: name.trim() }),
    }),
    onSuccess: async () => {
      onMessage("Passkey name updated.");
      setEditingPasskeyId(null);
      setEditingPasskeyName("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-passkeys"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "Passkey name could not be updated."),
  });

  const removePasskey = useMutation({
    mutationFn: (id: string) => jsonRequest("/api/passkeys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
    onSuccess: async () => {
      onMessage("Passkey removed.");
      setEditingPasskeyId(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-passkeys"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "Passkey could not be removed."),
  });

  const openPasskeyNameForm = () => {
    onMessage(null);
    setEditingPasskeyId(null);
    setNewPasskeyName(suggestedPasskeyName());
    setIsNamingPasskey(true);
  };

  return (
      <div className="card settings-card-block settings-passkeys-card">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title">Passkeys</div>
            <div className="settings-section-copy">Sign in securely with Face ID, Touch ID, Windows Hello, or a security key.</div>
          </div>
          <Button className="btn btn-primary btn-xs" type="button" onClick={openPasskeyNameForm} disabled={!supported || addPasskey.isPending || isNamingPasskey}>
            Add Passkey
          </Button>
        </div>

        {isNamingPasskey ? (
          <form
            className="settings-passkey-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (newPasskeyName.trim()) addPasskey.mutate(newPasskeyName);
            }}
          >
            <label htmlFor="new-passkey-name">Passkey name</label>
            <Input
              id="new-passkey-name"
              className="input"
              value={newPasskeyName}
              onChange={(event) => setNewPasskeyName(event.target.value)}
              maxLength={80}
              placeholder="e.g. Peter's iPhone or YubiKey"
              autoFocus
              required
            />
            <p>Choose a name that identifies the device, browser, or security key. You can rename it later.</p>
            <div className="settings-passkey-form-actions">
              <Button
                className="btn btn-ghost btn-xs"
                type="button"
                onClick={() => {
                  setIsNamingPasskey(false);
                  setNewPasskeyName("");
                }}
                disabled={addPasskey.isPending}
              >
                Cancel
              </Button>
              <Button className="btn btn-primary btn-xs" type="submit" disabled={!newPasskeyName.trim() || addPasskey.isPending}>
                {addPasskey.isPending ? "Adding..." : "Continue"}
              </Button>
            </div>
          </form>
        ) : null}

        {passkeys.isLoading ? <div className="settings-muted-message settings-message-spaced">Loading passkeys...</div> : null}
        {passkeys.isError ? <div className="settings-message settings-message-spaced">Passkeys could not be loaded.</div> : null}
        {passkeys.data?.passkeys.length ? (
          <div className="settings-passkey-list">
            {passkeys.data.passkeys.map((passkey) => (
              <div className="settings-passkey-item" key={passkey.id}>
                {editingPasskeyId === passkey.id ? (
                  <form
                    className="settings-passkey-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (editingPasskeyName.trim()) renamePasskey.mutate({ id: passkey.id, name: editingPasskeyName });
                    }}
                  >
                    <Input
                      className="input"
                      value={editingPasskeyName}
                      onChange={(event) => setEditingPasskeyName(event.target.value)}
                      maxLength={80}
                      aria-label={`Name for ${passkey.name || "passkey"}`}
                      autoFocus
                      required
                    />
                    <div className="settings-passkey-edit-actions">
                      <Button
                        className="btn btn-ghost btn-xs"
                        type="button"
                        onClick={() => {
                          setEditingPasskeyId(null);
                          setEditingPasskeyName("");
                        }}
                        disabled={renamePasskey.isPending}
                      >
                        Cancel
                      </Button>
                      <Button className="btn btn-primary btn-xs" type="submit" disabled={!editingPasskeyName.trim() || renamePasskey.isPending}>
                        {renamePasskey.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="settings-passkey-copy">
                      <strong>{passkey.name || "Unnamed passkey"}</strong>
                      <span>{passkeyMetadata(passkey)}</span>
                    </div>
                    <div className="settings-passkey-actions">
                      <Button
                        className="btn-icon settings-passkey-icon-button"
                        type="button"
                        onClick={() => {
                          setIsNamingPasskey(false);
                          setEditingPasskeyId(passkey.id);
                          setEditingPasskeyName(passkey.name || suggestedPasskeyName());
                        }}
                        disabled={renamePasskey.isPending || removePasskey.isPending}
                        aria-label={`Rename ${passkey.name || "passkey"}`}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </Button>
                      <Button
                        className="btn-icon settings-passkey-icon-button"
                        type="button"
                        onClick={() => removePasskey.mutate(passkey.id)}
                        disabled={removePasskey.isPending || renamePasskey.isPending}
                        aria-label={`Remove ${passkey.name || "passkey"}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {!passkeys.data?.passkeys.length && !passkeys.isLoading && !passkeys.isError ? (
          <div className="settings-muted-message settings-message-spaced">No passkeys added yet.</div>
        ) : null}
      </div>

  );
}

function LoginSessionSettings({ onMessage }: Readonly<{ onMessage: AccessMessage }>) {
  const queryClient = useQueryClient();
  const loginSessions = useQuery({
    queryKey: queryKeys.key(["settings-login-sessions"]),
    queryFn: () => jsonRequest<{ sessions: LoginSession[] }>("/api/auth/sessions"),
  });

  const revokeSession = useMutation({
    mutationFn: async (session: LoginSession) => {
      const result = await jsonRequest<{ revoked: boolean; current: boolean }>("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      return { ...result, session };
    },
    onSuccess: async ({ current, session }) => {
      if (current) {
        await signOut({ callbackUrl: "/" });
        return;
      }
      onMessage(`${session.deviceName} was signed out.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-login-sessions"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "The device could not be signed out."),
  });

  return (
      <div className="card settings-card-block">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title">Active sessions</div>
            <div className="settings-section-copy">
              Stay signed in on up to five devices. Sign out any device you no longer use or recognize.
            </div>
          </div>
        </div>
        {loginSessions.isLoading ? <div className="settings-muted-message settings-message-spaced">Loading active sessions...</div> : null}
        {loginSessions.isError ? <div className="settings-message settings-message-spaced">Active sessions could not be loaded.</div> : null}
        {loginSessions.data?.sessions.length ? (
          <div className="settings-passkey-list">
            {loginSessions.data.sessions.map((session) => (
              <div className="settings-passkey-item" key={session.sessionId}>
                <div className="settings-passkey-copy">
                  <strong>{session.deviceName}</strong>
                  <span>{loginSessionLocation(session)}</span>
                  <span>{loginSessionDetails(session)}</span>
                </div>
                <div className="settings-session-actions">
                  {session.current ? <span className="settings-status-pill is-enabled">Current</span> : null}
                  <Button
                    className="btn btn-ghost btn-xs"
                    type="button"
                    onClick={() => revokeSession.mutate(session)}
                    disabled={revokeSession.isPending}
                  >
                    {revokeSession.isPending && revokeSession.variables?.sessionId === session.sessionId
                      ? "Signing out..."
                      : "Sign out"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {!loginSessions.data?.sessions.length && !loginSessions.isLoading && !loginSessions.isError ? (
          <div className="settings-muted-message settings-message-spaced">No active sessions were found.</div>
        ) : null}
      </div>

  );
}

function NotificationSettings({ supported, onMessage }: Readonly<{ supported: boolean; onMessage: AccessMessage }>) {
  const queryClient = useQueryClient();
  const pushStatus = useQuery({
    queryKey: queryKeys.key(["settings-push-status"]),
    queryFn: () => jsonRequest<PushStatus>("/api/push-subscriptions"),
  });

  const enableNotifications = useMutation({
    mutationFn: async () => {
      const subscription = await preparePushSubscription(pushStatus.data, supported);
      await jsonRequest("/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    },
    onSuccess: async () => {
      onMessage("Notifications enabled.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-push-status"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "Notifications could not be enabled."),
  });

  const disableNotifications = useMutation({
    mutationFn: async () => {
      const subscription = await getBrowserPushSubscription();
      await jsonRequest("/api/push-subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    },
    onSuccess: async () => {
      onMessage("Notifications disabled.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-push-status"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "Notifications could not be disabled."),
  });

  const revokeNotificationDevice = useMutation({
    mutationFn: (subscriptionId: string) => jsonRequest("/api/push-subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId }),
    }),
    onSuccess: async () => {
      onMessage("Notification device revoked.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.key(["settings-push-status"]) });
    },
    onError: (error) => onMessage(error instanceof Error ? error.message : "The notification device could not be revoked."),
  });

  return <>
        <div className="settings-row settings-row-spaced">
          <div className="settings-item-copy">
            <div className="settings-section-title">Notifications</div>
            <div className="settings-section-copy">
              {!pushStatus.data?.configured
                ? "Notification delivery has not been configured for this deployment."
                : "Receive scheduled reminders for credit card payments that are due, plus workspace invitations."}
            </div>
          </div>
          {pushStatus.data?.subscribed ? (
            <Button className="btn btn-ghost btn-xs" type="button" onClick={() => disableNotifications.mutate()} disabled={disableNotifications.isPending}>
              {disableNotifications.isPending ? "Disabling..." : "Disable"}
            </Button>
          ) : (
            <Button
              className="btn btn-primary btn-xs"
              type="button"
              onClick={() => enableNotifications.mutate()}
              disabled={!supported || !pushStatus.data?.configured || enableNotifications.isPending}
            >
              {enableNotifications.isPending ? "Enabling..." : "Enable"}
            </Button>
          )}
        </div>
        {pushStatus.data?.subscriptions.length ? (
          <div className="settings-passkey-list settings-message-spaced" aria-label="Notification devices">
            {pushStatus.data.subscriptions.map((subscription) => (
              <div className="settings-passkey-item" key={subscription.id}>
                <div className="settings-passkey-copy">
                  <strong>{subscription.provider}</strong>
                  <span>
                    Registered {new Date(subscription.createdAt).toLocaleDateString("en-SG")} · Last refreshed {new Date(subscription.updatedAt).toLocaleDateString("en-SG")}
                  </span>
                </div>
                <Button
                  className="btn btn-ghost btn-xs"
                  type="button"
                  onClick={() => revokeNotificationDevice.mutate(subscription.id)}
                  disabled={revokeNotificationDevice.isPending}
                >
                  {revokeNotificationDevice.isPending && revokeNotificationDevice.variables === subscription.id ? "Revoking..." : "Revoke"}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
    </>;
}
