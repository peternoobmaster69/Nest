export type GmailSyncSummary = {
  scannedMessages: number;
  processed: number;
  duplicates: number;
  failed: number;
  skipped?: boolean;
  reason?: string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function formatGmailSyncSummary(data: GmailSyncSummary) {
  if (data.skipped && data.reason) return data.reason;

  if (data.scannedMessages === 0) {
    return "Inbox is up to date. No new card alert emails were found.";
  }

  const imported = `${data.processed} new ${pluralize(data.processed, "card alert")}`;
  const duplicateDetail = data.duplicates > 0
    ? ` Skipped ${data.duplicates} ${pluralize(data.duplicates, "email")} already imported.`
    : "";

  if (data.failed > 0) {
    return `Inbox sync completed with issues. Imported ${imported}.${duplicateDetail} ${data.failed} ${pluralize(data.failed, "email")} could not be processed.`;
  }

  if (data.processed === 0) {
    return `Inbox is up to date.${duplicateDetail || " No new card alerts needed importing."}`;
  }

  return `Inbox sync complete. Imported ${imported}.${duplicateDetail}`;
}
