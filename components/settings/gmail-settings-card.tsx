"use client";

import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsOperationNotice } from "./operation-notice";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import type { useGmailSettings } from "@/hooks/use-gmail-settings";

type GmailSettingsController = ReturnType<typeof useGmailSettings>;

function formatGmailScope(scope: string | null) {
  if (!scope) return "Read-only access to card-alert email metadata and content";
  const scopes = scope.split(/\s+/).filter(Boolean);
  if (scopes.every((value) => value.endsWith("/gmail.readonly"))) {
    return "Read-only Gmail messages (Nest cannot send, edit, or delete mail)";
  }
  return scopes.map((value) => value.split("/").at(-1)?.replaceAll(".", " ") || value).join(", ");
}

function GmailConnectButton({ controller, reconnect = false }: Readonly<{
  controller: GmailSettingsController;
  reconnect?: boolean;
}>) {
  const { connectGmail, disconnectGmail } = controller;
  const label = reconnect ? "Reconnect Gmail" : "Connect Gmail";
  return (
    <Button className="btn btn-primary btn-xs" onClick={() => connectGmail.mutate()} disabled={connectGmail.isPending || disconnectGmail.isPending}>
      {connectGmail.isPending ? "Redirecting..." : label}
    </Button>
  );
}

function GmailActions({ controller }: Readonly<{ controller: GmailSettingsController }>) {
  const { gmailStatus, syncGmail, disconnectGmail, connectGmail, confirmDisconnectGmail,
    isGmailSyncPolling, gmailRequiresReconnect } = controller;
  if (!gmailStatus.data?.connected) return <GmailConnectButton controller={controller} />;
  return (
    <div className="gmail-alerts-actions">
      {gmailRequiresReconnect ? <GmailConnectButton controller={controller} reconnect /> : (
        <Button className="btn btn-ghost btn-xs" onClick={() => syncGmail.mutate()} disabled={syncGmail.isPending || isGmailSyncPolling || disconnectGmail.isPending}>
          {syncGmail.isPending || isGmailSyncPolling ? "Syncing..." : "Sync Inbox"}
        </Button>
      )}
      <Button className="btn btn-ghost btn-xs" onClick={() => void confirmDisconnectGmail()} disabled={disconnectGmail.isPending || syncGmail.isPending || connectGmail.isPending}>
        Disconnect
      </Button>
    </div>
  );
}

export function GmailSettingsCard({ controller, routeWorkspaceId }: Readonly<{
  controller: GmailSettingsController;
  routeWorkspaceId?: string | null;
}>) {
  const { gmailStatus, gmailSyncProgress, isGmailSyncActive, gmailRequiresReauthentication, gmailNotice } = controller;
  return (
    <div className="card settings-card-block gmail-alerts-card">
      <div className="gmail-alerts-header">
        <div className="gmail-alerts-copy">
          <div className="gmail-alerts-title-row">
            <div className="settings-section-title">Gmail Card Alerts</div>
            <a
              href={routeWorkspaceId ? buildWorkspacePath(routeWorkspaceId, "/credit-alerts") : "/credit-alerts"}
              target="_blank"
              rel="noreferrer"
              className="settings-inline-link"
            >
              Open Staging Table
            </a>
          </div>
          <div className="settings-section-copy">
            Authorize once for read-only Gmail access. Nest only scans card transaction alert emails, extracts transaction details,
            and auto-adds them to Credit Card Transactions for tracking. Nest does not send, delete, or modify your emails.
          </div>
        </div>
        <GmailActions controller={controller} />
      </div>
      {gmailStatus.data?.connected && gmailStatus.data.integration ? (
        <div className="settings-integration-details">
          <div className="settings-message">
            Connected: <strong>{gmailStatus.data.integration.email}</strong>
            {gmailStatus.data.integration.lastSyncedAt
              ? ` · Last sync: ${new Date(gmailStatus.data.integration.lastSyncedAt).toLocaleString()}`
              : " · Never synced"}
          </div>
          <div className="settings-muted-message">Data scope: {formatGmailScope(gmailStatus.data.integration.scope)}</div>
        </div>
      ) : (
        <div className="settings-muted-message">Not connected.</div>
      )}
      {isGmailSyncActive && gmailSyncProgress ? (
        <output className="gmail-sync-progress-wrap" aria-label="Gmail inbox sync progress" aria-live="polite">
          <div className="gmail-sync-progress-header">
            <LoaderCircle className="gmail-sync-spinner" size={18} aria-hidden="true" />
            <div className="gmail-sync-progress-copy">
              <strong>Syncing Gmail inbox</strong>
              <span>{gmailSyncProgress.message || "Reading card alerts…"}</span>
            </div>
            <span className="gmail-sync-progress-value">{Math.round(gmailSyncProgress.progress)}%</span>
          </div>
          <progress className="gmail-sync-progress" value={Math.min(gmailSyncProgress.progress, 100)} max={100} />
        </output>
      ) : null}
      {!isGmailSyncActive ? (
        <SettingsOperationNotice
          notice={gmailNotice}
          requiresReauthentication={gmailRequiresReauthentication}
        />
      ) : null}
    </div>
  );
}
