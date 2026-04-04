const GMAIL_ALERT_SUBJECT_QUERY = [
  "(",
  'subject:"UOB - Transaction Alert"',
  'OR subject:"Your transaction has been reversed"',
  'OR subject:"Card Transaction Alert"',
  'OR subject:"Citi Alerts - Credit Card/Ready Credit Transaction"',
  ")",
].join(" ");

export const GMAIL_SYNC_LOOKBACK_MS = 15 * 60 * 1000;
export const GMAIL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const GMAIL_DEFAULT_WINDOW_DAYS = 30;

export function isGmailSyncDue(lastSyncedAt: Date | null, now = Date.now()) {
  if (!lastSyncedAt) return true;
  return now - lastSyncedAt.getTime() >= GMAIL_SYNC_INTERVAL_MS;
}

export function buildGmailAlertQuery(lastSyncedAt: Date | null) {
  if (!lastSyncedAt) {
    return [`newer_than:${GMAIL_DEFAULT_WINDOW_DAYS}d`, GMAIL_ALERT_SUBJECT_QUERY].join(" ");
  }

  const incrementalStart = new Date(lastSyncedAt.getTime() - GMAIL_SYNC_LOOKBACK_MS);
  const afterTimestamp = Math.floor(incrementalStart.getTime() / 1000);
  return [`after:${afterTimestamp}`, GMAIL_ALERT_SUBJECT_QUERY].join(" ");
}

export function getGmailSyncWindowLabel(lastSyncedAt: Date | null) {
  if (!lastSyncedAt) return "last 30 days";
  return `last sync minus 15 minutes (${new Date(lastSyncedAt.getTime() - GMAIL_SYNC_LOOKBACK_MS).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
  })})`;
}
