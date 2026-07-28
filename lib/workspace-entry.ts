const DEFAULT_APP_DESTINATION = "/";
const WORKSPACE_ENTRY_PATH = "/entry";
const WORKSPACE_PATH_PREFIX = "/w";

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

export function getWorkspaceIdFromPathname(pathname: string) {
  const match = /^\/w\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function getWorkspaceRelativePath(pathname: string) {
  const match = /^\/w\/[^/]+(\/.*)?$/.exec(pathname);
  return match ? match[1] || "/" : pathname;
}

export function buildWorkspacePath(
  workspaceId: string,
  destination = DEFAULT_APP_DESTINATION,
) {
  const normalized = normalizeInternalAppPath(destination);
  const parsed = new URL(normalized, "https://nest.invalid");
  const relativePath = getWorkspaceRelativePath(parsed.pathname);
  const suffix = relativePath === "/" ? "" : relativePath;
  return `${WORKSPACE_PATH_PREFIX}/${encodeURIComponent(workspaceId.trim())}${suffix}${parsed.search}${parsed.hash}`;
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
