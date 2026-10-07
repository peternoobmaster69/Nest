import { isRecentAuthenticationRequired } from "@/components/reauthentication-message";
import type { SettingsOperationNoticeData } from "./operation-notice";

type GmailSyncProgress = { phase: "idle" | "queued" | "reading" | "writing" | "complete" | "error" | "cancelled" };

export function getGmailNotice(message: string, phase?: GmailSyncProgress["phase"]): SettingsOperationNoticeData | null {
  const normalized = message.trim();
  if (!normalized) return null;

  if (isRecentAuthenticationRequired(normalized)) {
    return {
      title: "Re-authentication required",
      detail: "Sign in again to continue this security-sensitive action.",
      tone: "warning",
    };
  }

  const lastSyncedMarker = " Last synced at ";
  const lastSyncedIndex = normalized.indexOf(lastSyncedMarker);
  const sentenceBreakIndex = normalized.indexOf(". ");
  const title = lastSyncedIndex >= 0
    ? normalized.slice(0, lastSyncedIndex).replace(/\.$/, "")
    : sentenceBreakIndex >= 0
      ? normalized.slice(0, sentenceBreakIndex)
      : normalized.replace(/\.$/, "");
  const detail = lastSyncedIndex >= 0
    ? normalized.slice(lastSyncedIndex + 1)
    : sentenceBreakIndex >= 0
      ? normalized.slice(sentenceBreakIndex + 2)
      : null;
  const hasProcessingIssues = /could not be processed|completed with issues/i.test(normalized)
    && !/\b0 failed\b/i.test(normalized);
  const hasFailure = /failed|denied|forbidden|error/i.test(normalized)
    && !/\b0 failed\b/i.test(normalized);
  const tone = phase === "error" || hasFailure
    ? "error"
    : hasProcessingIssues
      ? "warning"
      : /skipped|queued|running|syncing|disconnected|up to date|no new|synced 0 emails/i.test(normalized)
        ? "info"
        : "success";

  return { title, detail, tone };
}

export function getAutoAccountingNotice(message: string): SettingsOperationNoticeData | null {
  const normalized = message.trim();
  if (!normalized) return null;

  if (isRecentAuthenticationRequired(normalized)) {
    return {
      title: "Re-authentication required",
      detail: "Sign in again to continue this security-sensitive action.",
      tone: "warning",
    };
  }

  const runResult = /^Auto-accounted (\d+) transactions? from (\d+) matched rule hits?\.$/i.exec(normalized);
  if (runResult) {
    const accounted = Number(runResult[1]);
    const matched = Number(runResult[2]);
    if (accounted === 0) {
      return {
        title: "No transactions auto-accounted",
        detail: matched === 0
          ? "No unaccounted transactions matched your enabled rules."
          : `${matched} matched rule ${matched === 1 ? "hit was" : "hits were"} found, but no transactions were accounted.`,
        tone: matched === 0 ? "info" : "warning",
      };
    }
    return {
      title: `Auto-accounted ${accounted} transaction${accounted === 1 ? "" : "s"}`,
      detail: `${matched} matched rule ${matched === 1 ? "hit" : "hits"}.`,
      tone: "success",
    };
  }

  const sentenceBreakIndex = normalized.indexOf(". ");
  const title = sentenceBreakIndex >= 0
    ? normalized.slice(0, sentenceBreakIndex)
    : normalized.replace(/\.$/, "");
  const detail = sentenceBreakIndex >= 0 ? normalized.slice(sentenceBreakIndex + 2) : null;
  const tone = /failed|error|unable/i.test(normalized)
    ? "error"
    : /\bneeds?\b|could not|skipped/i.test(normalized)
      ? "warning"
      : "success";

  return { title, detail, tone };
}
