import { GMAIL_SYNC_INTERVAL_MS } from "@/lib/gmail-alert-query";
import { runScheduledGmailSyncs } from "@/lib/gmail-sync-runner";

declare global {
  // eslint-disable-next-line no-var
  var __nestGmailSyncSchedulerStarted: boolean | undefined;
}

function canStartScheduler() {
  if (typeof window !== "undefined") return false;
  if (process.env.npm_lifecycle_event === "build") return false;
  return true;
}

export function startGmailSyncScheduler() {
  if (!canStartScheduler()) return;
  if (globalThis.__nestGmailSyncSchedulerStarted) return;

  globalThis.__nestGmailSyncSchedulerStarted = true;

  const tick = async () => {
    try {
      await runScheduledGmailSyncs();
    } catch (error) {
      console.error("Gmail scheduler tick failed:", error);
    }
  };

  setTimeout(() => {
    void tick();
  }, 15_000);

  setInterval(() => {
    void tick();
  }, GMAIL_SYNC_INTERVAL_MS);
}
