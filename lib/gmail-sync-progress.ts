type GmailSyncPhase = "idle" | "reading" | "writing" | "complete" | "error";

export type GmailSyncProgressState = {
  phase: GmailSyncPhase;
  progress: number;
  message: string;
  total: number;
  current: number;
  updatedAt: number;
};

const progressStore = new Map<string, GmailSyncProgressState>();

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getGmailSyncProgressKey(workspaceId: string, userId: string) {
  return `${workspaceId}:${userId}`;
}

export function getGmailSyncProgress(key: string) {
  return (
    progressStore.get(key) ?? {
      phase: "idle",
      progress: 0,
      message: "",
      total: 0,
      current: 0,
      updatedAt: Date.now(),
    }
  );
}

export function setGmailSyncProgress(
  key: string,
  next: Partial<GmailSyncProgressState> & Pick<GmailSyncProgressState, "phase">,
) {
  const current = getGmailSyncProgress(key);
  progressStore.set(key, {
    ...current,
    ...next,
    progress: next.progress === undefined ? current.progress : clampProgress(next.progress),
    updatedAt: Date.now(),
  });
}

export function clearGmailSyncProgressLater(key: string, delayMs = 15000) {
  const updatedAt = Date.now();
  setTimeout(() => {
    const current = progressStore.get(key);
    if (current && current.updatedAt <= updatedAt) {
      progressStore.delete(key);
    }
  }, delayMs);
}
