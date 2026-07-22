import {
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
} from "@/lib/credential-encryption";

const MAX_DIAGNOSTIC_BODY_CHARS = 32_000;
const TRUNCATION_MARKER = "\n\n[Diagnostic sample truncated]";

function creditAlertBodyContext(workspaceId: string, sourceMessageKey: string) {
  return `credit-alert:${workspaceId}:${sourceMessageKey}:rawBody`;
}

export function sealFailedCreditAlertBody(params: {
  workspaceId: string;
  sourceMessageKey: string;
  rawBody: string;
  contentHash: string;
}) {
  const boundedBody = params.rawBody.length > MAX_DIAGNOSTIC_BODY_CHARS
    ? `${params.rawBody.slice(0, MAX_DIAGNOSTIC_BODY_CHARS)}${TRUNCATION_MARKER}`
    : params.rawBody;

  try {
    return encryptCredential(
      boundedBody,
      creditAlertBodyContext(params.workspaceId, params.sourceMessageKey),
    );
  } catch {
    return `[diagnostic body unavailable; sha256:${params.contentHash}]`;
  }
}

export function openFailedCreditAlertBody(params: {
  workspaceId: string;
  sourceMessageKey: string | null;
  storedBody: string;
}) {
  if (!params.sourceMessageKey || !isEncryptedCredential(params.storedBody)) return null;

  try {
    return decryptCredential(
      params.storedBody,
      creditAlertBodyContext(params.workspaceId, params.sourceMessageKey),
    );
  } catch {
    return null;
  }
}
