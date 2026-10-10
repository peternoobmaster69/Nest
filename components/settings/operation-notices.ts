import { isRecentAuthenticationRequired } from "@/components/reauthentication-message";
import type { SettingsOperationNoticeData } from "./operation-notice";

type GmailSyncProgress = { phase: "idle" | "queued" | "reading" | "writing" | "complete" | "error" | "cancelled" };

function splitNotice(message: string, marker?: string) {
  const markerIndex = marker === undefined ? -1 : message.indexOf(marker);
  if (markerIndex >= 0) return { title: message.slice(0, markerIndex).replace(/\.$/, ""), detail: message.slice(markerIndex + 1) };
  const sentenceBreakIndex = message.indexOf(". ");
  if (sentenceBreakIndex >= 0) return { title: message.slice(0, sentenceBreakIndex), detail: message.slice(sentenceBreakIndex + 2) };
  return { title: message.replace(/\.$/, ""), detail: null };
}

function gmailNoticeTone(message: string, phase?: GmailSyncProgress["phase"]): SettingsOperationNoticeData["tone"] {
  const hasProcessingIssues = /could not be processed|completed with issues/i.test(message)
    && !/\b0 failed\b/i.test(message);
  const hasFailure = /failed|denied|forbidden|error/i.test(message) && !/\b0 failed\b/i.test(message);
  if (phase === "error" || hasFailure) return "error";
  if (hasProcessingIssues) return "warning";
  if (/skipped|queued|running|syncing|disconnected|up to date|no new|synced 0 emails/i.test(message)) return "info";
  return "success";
}

function autoAccountingTone(message: string): SettingsOperationNoticeData["tone"] {
  if (/failed|error|unable/i.test(message)) return "error";
  if (/\bneeds?\b|could not|skipped/i.test(message)) return "warning";
  return "success";
}

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

  return { ...splitNotice(normalized, " Last synced at "), tone: gmailNoticeTone(normalized, phase) };
}

function autoAccountingRunNotice(accounted: number, matched: number): SettingsOperationNoticeData {
  if (accounted === 0) {
    const matchedHits = matched === 1 ? "hit was" : "hits were";
    return {
      title: "No transactions auto-accounted",
      detail: matched === 0
        ? "No unaccounted transactions matched your enabled rules."
        : `${matched} matched rule ${matchedHits} found, but no transactions were accounted.`,
      tone: matched === 0 ? "info" : "warning",
    };
  }
  return {
    title: `Auto-accounted ${accounted} transaction${accounted === 1 ? "" : "s"}`,
    detail: `${matched} matched rule ${matched === 1 ? "hit" : "hits"}.`,
    tone: "success",
  };
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
    return autoAccountingRunNotice(Number(runResult[1]), Number(runResult[2]));
  }

  return { ...splitNotice(normalized), tone: autoAccountingTone(normalized) };
}
