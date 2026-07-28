export const GMAIL_ALERT_SUBJECTS = [
  "UOB - Transaction Alert",
  "Your transaction has been reversed",
  "Card Transaction Alert",
  "Citi Alerts - Credit Card/Ready Credit Transaction",
] as const;

const GMAIL_ALERT_SUBJECT_QUERY = `(${GMAIL_ALERT_SUBJECTS
  .map((subject) => `subject:"${subject}"`)
  .join(" OR ")})`;

const GMAIL_SYNC_LOOKBACK_MS = 15 * 60 * 1000;
const GMAIL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const GMAIL_DEFAULT_WINDOW_DAYS = 30;

export function isGmailCreditAlertSubject(subject: string) {
  const normalized = subject.trim().toLocaleLowerCase();
  return GMAIL_ALERT_SUBJECTS.some((candidate) =>
    normalized.includes(candidate.toLocaleLowerCase()),
  );
}

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
