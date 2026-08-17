export function getGmailSyncProgressCounters(scannedMessages: number, persistedTotal?: number | null) {
  const current = Math.max(0, Math.floor(scannedMessages));
  const total = Math.max(current, Math.floor(persistedTotal ?? 0));
  return { current, total };
}
