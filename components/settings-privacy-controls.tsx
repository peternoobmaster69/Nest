"use client";

import { signOut } from "next-auth/react";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { usePrivacyConsent } from "@/components/privacy-consent";
import { ActionableAuthenticationMessage } from "@/components/reauthentication-message";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/controls";
import {
  clearNestOfflineStorage,
  getOfflineStorageSummary,
  purgePrivateServiceWorkerCaches,
  type OfflineStorageSummary,
} from "@/lib/service-worker-cache";
import { workspaceFetch } from "@/lib/workspace-client";

const EMPTY_OFFLINE_SUMMARY: OfflineStorageSummary = { supported: false, cacheCount: 0, entryCount: 0 };

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
  return payload.message || payload.error || fallback;
}

export function SettingsPrivacyControls({ view = "privacy" }: { view?: "privacy" | "data" }) {
  const { consent, updateConsent } = usePrivacyConsent();
  const [offlineSummary, setOfflineSummary] = useState(EMPTY_OFFLINE_SUMMARY);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [clearingOffline, setClearingOffline] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const refreshOfflineSummary = async () => setOfflineSummary(await getOfflineStorageSummary());
  useEffect(() => {
    void refreshOfflineSummary();
  }, []);

  const exportData = async () => {
    setExporting(true);
    setMessage("");
    try {
      const response = await workspaceFetch("/api/profile/export", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "Your data could not be exported."));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "nest-account-export.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("Your account export was downloaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your data could not be exported.");
    } finally {
      setExporting(false);
    }
  };

  const clearOffline = async () => {
    setClearingOffline(true);
    setMessage("");
    try {
      await clearNestOfflineStorage();
      await refreshOfflineSummary();
      setMessage("Offline shell files were cleared. Private finance responses were never stored for offline use.");
    } catch {
      setMessage("Offline files could not be cleared in this browser.");
    } finally {
      setClearingOffline(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setMessage("");
    try {
      const response = await workspaceFetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Your account could not be deleted."));
      await purgePrivateServiceWorkerCaches();
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        // Server-side deletion has already succeeded; browser storage is best effort.
      }
      await signOut({ redirect: false }).catch(() => undefined);
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your account could not be deleted.");
      setDeleteDialogOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {view === "privacy" ? (
        <>
      <section className="card settings-card-block" aria-labelledby="privacy-telemetry-heading">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title" id="privacy-telemetry-heading">Optional telemetry</div>
            <div className="settings-section-copy">Essential authentication and security storage is always enabled. Change optional collection at any time.</div>
          </div>
        </div>
        <div className="privacy-preference-list">
          <label className="privacy-preference-row">
            <span><strong>Product analytics</strong><small>Feature usage through Vercel Analytics; no finance values are sent.</small></span>
            <Input type="checkbox" checked={consent?.analytics ?? false} onChange={(event) => updateConsent({ analytics: event.target.checked, performance: consent?.performance ?? false })} />
          </label>
          <label className="privacy-preference-row">
            <span><strong>Performance measurement</strong><small>Web-vital timing data through Speed Insights and the Nest performance reporter.</small></span>
            <Input type="checkbox" checked={consent?.performance ?? false} onChange={(event) => updateConsent({ analytics: consent?.analytics ?? false, performance: event.target.checked })} />
          </label>
        </div>
      </section>

      <section className="card settings-card-block" aria-labelledby="privacy-offline-heading">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title" id="privacy-offline-heading">Offline storage</div>
            <div className="settings-section-copy">
              Nest stores only the static offline shell, icons, and application assets. Authenticated finance API responses and offline mutations are never cached.
            </div>
          </div>
          <Button className="btn btn-ghost btn-xs" onClick={clearOffline} disabled={!offlineSummary.supported || clearingOffline}>
            {clearingOffline ? "Clearing..." : "Clear offline files"}
          </Button>
        </div>
        <div className="settings-muted-message settings-message-spaced" role="status">
          {offlineSummary.supported
            ? `${offlineSummary.entryCount} static ${offlineSummary.entryCount === 1 ? "file" : "files"} in ${offlineSummary.cacheCount} Nest ${offlineSummary.cacheCount === 1 ? "cache" : "caches"}.`
            : "This browser does not expose offline cache storage."}
        </div>
      </section>
        </>
      ) : (
        <>

      <section className="card settings-card-block" aria-labelledby="privacy-data-heading">
        <div className="settings-row">
          <div className="settings-item-copy">
            <div className="settings-section-title" id="privacy-data-heading">Account data</div>
            <div className="settings-section-copy">Download a machine-readable JSON copy of your profile, workspace memberships, finance records, notes, notifications, and security-device metadata.</div>
          </div>
          <Button className="btn btn-primary btn-xs" onClick={exportData} disabled={exporting}>
            {exporting ? "Preparing..." : "Export my data"}
          </Button>
        </div>
        <div className="settings-row settings-row-spaced privacy-danger-row">
          <div className="settings-item-copy">
            <div className="settings-section-title">Delete Nest account</div>
            <div className="settings-section-copy">Permanently deletes your identity, credentials, integrations, notifications, and memberships. Shared finance history is retained with your identity removed.</div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => { setDeleteConfirmation(""); setDeleteDialogOpen(true); }}>
            <Trash2 size={15} aria-hidden="true" /> Delete account
          </Button>
        </div>
        <ActionableAuthenticationMessage message={message} className="settings-access-message" />
      </section>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        title="Permanently delete your account?"
        size="sm"
        closeDisabled={deleting}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={deleteAccount} disabled={deleting || deleteConfirmation !== "DELETE MY ACCOUNT"}>
              {deleting ? "Deleting..." : "Delete permanently"}
            </Button>
          </>
        }
      >
        <p>This cannot be undone. If you are the only owner of a workspace, transfer ownership or delete that workspace first.</p>
        <label className="form-group" htmlFor="delete-account-confirmation">
          <span className="label">Type <strong>DELETE MY ACCOUNT</strong> to continue</span>
          <Input id="delete-account-confirmation" className="input" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" aria-describedby="delete-account-help" />
          <small id="delete-account-help" className="form-hint">A recent sign-in is required.</small>
        </label>
      </Dialog>
        </>
      )}
    </>
  );
}
