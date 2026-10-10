"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch as fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { formatGmailSyncSummary, type GmailSyncSummary } from "@/lib/gmail-sync-summary";
import { getGmailNotice } from "@/components/settings/operation-notices";
import { isRecentAuthenticationRequired } from "@/components/reauthentication-message";
import { useConfirmDialog } from "@/components/confirm-dialog";

type GmailStatus = {
  connected: boolean;
  requiresReconnect: boolean;
  integration: {
    id: string;
    email: string;
    scope: string | null;
    lastSyncedAt: string | null;
    createdAt: string;
  } | null;
};

type GmailSyncProgress = {
  phase: "idle" | "queued" | "reading" | "writing" | "complete" | "error" | "cancelled";
  progress: number;
  message: string;
  total: number;
  current: number;
  updatedAt: number;
  errorCode?: string | null;
};

type GmailSyncStartResponse = Partial<GmailSyncSummary> & {
  ok?: boolean;
  queued?: boolean;
  jobId?: string;
  message?: string;
  errorCode?: string | null;
};

function hasGmailSyncSummary(data: GmailSyncStartResponse): data is GmailSyncSummary {
  return (
    typeof data.scannedMessages === "number" &&
    typeof data.processed === "number" &&
    typeof data.duplicates === "number" &&
    typeof data.failed === "number"
  );
}

function isTerminalSyncPhase(phase: GmailSyncProgress["phase"]) {
  return phase === "complete" || phase === "error" || phase === "cancelled" || phase === "idle";
}

export function useGmailSettings({ workspaceId, workspaceName, role }: {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
}) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const [gmailMessage, setGmailMessage] = useState("");
  const [gmailSyncProgress, setGmailSyncProgress] = useState<GmailSyncProgress | null>(null);
  const [isGmailSyncPolling, setIsGmailSyncPolling] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("gmail");
    if (!status) return;
    if (status === "connected") setGmailMessage("Gmail connected successfully.");
    else if (status === "denied") setGmailMessage("Gmail permission was denied.");
    else if (status === "forbidden") setGmailMessage("Gmail callback failed authorization.");
    else if (status === "refresh_required") setGmailMessage("Google did not return a reusable Gmail authorization. Reconnect Gmail and approve access again.");
    else setGmailMessage("Gmail connection failed.");
    url.searchParams.delete("gmail");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const gmailStatus = useQuery({
    queryKey: queryKeys.key(["gmail-status", workspaceId]),
    queryFn: () => fetchJson<GmailStatus>("/api/gmail/status"),
    enabled: role === "OWNER",
  });

  const connectGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ url: string }>("/api/gmail/connect", {
        method: "POST",
      }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => setGmailMessage(error instanceof Error ? error.message : "Failed to start Gmail connect."),
  });

  const syncGmail = useMutation({
    mutationFn: () =>
      fetchJson<GmailSyncStartResponse>("/api/gmail/sync", {
        method: "POST",
      }),
    onMutate: () => {
      setGmailMessage("Syncing Gmail inbox...");
      setGmailSyncProgress({
        phase: "reading",
        progress: 0,
        message: "Starting sync...",
        total: 0,
        current: 0,
        updatedAt: Date.now(),
      });
    },
    onSuccess: (data) => {
      if (!hasGmailSyncSummary(data)) {
        const message = data.message ?? (data.queued ? "Gmail sync queued." : "Gmail sync is running.");
        setGmailMessage(message);
        setGmailSyncProgress({
          phase: data.queued ? "queued" : "reading",
          progress: 0,
          message,
          total: 0,
          current: 0,
          updatedAt: Date.now(),
          errorCode: data.errorCode ?? null,
        });
        setIsGmailSyncPolling(true);
        return;
      }

      const message = formatGmailSyncSummary(data);
      setGmailMessage(message);
      setIsGmailSyncPolling(false);
      setGmailSyncProgress({
        phase: "complete",
        progress: 100,
        message,
        total: data.scannedMessages,
        current: data.scannedMessages,
        updatedAt: Date.now(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["gmail-status"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["credit-transactions"]) });
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]) });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Gmail sync failed.";
      setGmailMessage(message);
      setIsGmailSyncPolling(false);
      setGmailSyncProgress({ phase: "error", progress: 100, message, total: 0, current: 0, updatedAt: Date.now() });
    },
  });

  useEffect(() => {
    if (isGmailSyncPolling) return;
    if (!gmailSyncProgress || !isTerminalSyncPhase(gmailSyncProgress.phase)) return;
    const timeout = window.setTimeout(() => setGmailSyncProgress(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [gmailSyncProgress?.phase, isGmailSyncPolling]);

  useEffect(() => {
    if (!isGmailSyncPolling) return;
    let cancelled = false;
    let polling = false;

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const progress = await fetchJson<GmailSyncProgress>("/api/gmail/sync");
        if (!cancelled) {
          setGmailSyncProgress(progress);
          if (isTerminalSyncPhase(progress.phase)) {
            setGmailMessage(progress.message || "No Gmail sync is running.");
            setIsGmailSyncPolling(false);
            if (progress.phase === "complete") {
              queryClient.invalidateQueries({ queryKey: queryKeys.key(["gmail-status"]) });
              queryClient.invalidateQueries({ queryKey: queryKeys.key(["credit-transactions"]) });
              queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]) });
            }
          }
        }
      } catch {
        // A transient status failure can be retried without starting another sync.
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isGmailSyncPolling, queryClient]);

  const disconnectGmail = useMutation({
    mutationFn: () =>
      fetchJson<{ ok: true }>("/api/gmail/disconnect", {
        method: "POST",
      }),
    onSuccess: () => {
      setGmailMessage("Gmail disconnected.");
      setIsGmailSyncPolling(false);
      setGmailSyncProgress(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["gmail-status"]) });
    },
    onError: (error) => setGmailMessage(error instanceof Error ? error.message : "Failed to disconnect Gmail."),
  });

  const confirmDisconnectGmail = async () => {
    const approved = await confirm({
      title: "Disconnect Gmail?",
      message: "Nest will revoke its stored Gmail authorization and stop importing card alerts.",
      confirmLabel: "Disconnect Gmail",
      destructive: true,
      workspace: { name: workspaceName || "Current workspace", role: role || "OWNER" },
      details: [
        { label: "Google account", value: gmailStatus.data?.integration?.email || "Connected account" },
        { label: "Existing transactions", value: "Kept in Nest" },
        { label: "Future inbox sync", value: "Stopped" },
      ],
      reversal: "You can reconnect Gmail later and grant read-only access again.",
    });
    if (approved) disconnectGmail.mutate();
  };

  const isGmailSyncActive = Boolean(
    gmailSyncProgress && !isTerminalSyncPhase(gmailSyncProgress.phase),
  );
  const gmailRequiresReconnect = Boolean(
    gmailStatus.data?.requiresReconnect
      || gmailSyncProgress?.errorCode === "GMAIL_RECONNECT_REQUIRED"
      || /reconnect gmail/i.test(gmailMessage),
  );
  const gmailRequiresReauthentication = isRecentAuthenticationRequired(gmailMessage);
  const gmailNotice = getGmailNotice(gmailMessage, gmailSyncProgress?.phase);
  return { gmailStatus, connectGmail, syncGmail, disconnectGmail, confirmDisconnectGmail, gmailSyncProgress,
    isGmailSyncPolling, isGmailSyncActive, gmailRequiresReconnect, gmailRequiresReauthentication, gmailNotice };
}
