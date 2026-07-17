export const DEFAULT_APP_DESTINATION = "/";
export const WORKSPACE_ENTRY_PATH = "/entry";

export function normalizeInternalAppPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_APP_DESTINATION;
  }

  try {
    const base = new URL("https://nest.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return DEFAULT_APP_DESTINATION;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_APP_DESTINATION;
  }
}

export function buildWorkspaceEntryHref(workspaceId: string, destination = DEFAULT_APP_DESTINATION) {
  const params = new URLSearchParams({
    workspaceId: workspaceId.trim(),
    next: normalizeInternalAppPath(destination),
  });
  return `${WORKSPACE_ENTRY_PATH}?${params.toString()}`;
}

export function buildCreditCardStatementPath({
  cardId,
  statementMonth,
  statementYear,
}: {
  cardId: string;
  statementMonth: number;
  statementYear: number;
}) {
  const params = new URLSearchParams({
    cardId: cardId.trim(),
    month: String(statementMonth),
    year: String(statementYear),
  });
  return `/credit-transactions?${params.toString()}`;
}

export function buildAbsoluteWorkspaceEntryUrl(
  appUrl: string,
  workspaceId: string,
  destination = DEFAULT_APP_DESTINATION,
) {
  const baseUrl = appUrl.trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}${buildWorkspaceEntryHref(workspaceId, destination)}` : "";
}
