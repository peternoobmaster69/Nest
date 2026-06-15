import { getCreditTxnAutoAccountIntervalMs, runCreditTxnAutoAccounting } from "@/lib/credit-txn-auto-account-runner";

declare global {
  var __nestCreditTxnAutoAccountSchedulerStarted: boolean | undefined;
}

function canStartScheduler() {
  if (typeof window !== "undefined") return false;
  if (process.env.npm_lifecycle_event === "build") return false;
  return true;
}

export function startCreditTxnAutoAccountScheduler() {
  if (!canStartScheduler()) return;
  if (globalThis.__nestCreditTxnAutoAccountSchedulerStarted) return;

  globalThis.__nestCreditTxnAutoAccountSchedulerStarted = true;

  const tick = async () => {
    try {
      await runCreditTxnAutoAccounting();
    } catch (error) {
      console.error("Credit transaction auto-account scheduler tick failed:", error);
    }
  };

  setTimeout(() => {
    void tick();
  }, 20_000);

  setInterval(() => {
    void tick();
  }, getCreditTxnAutoAccountIntervalMs());
}
