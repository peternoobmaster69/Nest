import { trimEndCharacters } from "./string-boundaries.mjs";

const DEFAULT_APP_DESTINATION = "/";
const WORKSPACE_ENTRY_PATH = "/entry";
const WORKSPACE_PATH_PREFIX = "/w";

export function normalizeInternalAppPath(value: string | null | undefined, fallback = DEFAULT_APP_DESTINATION) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const base = new URL("https://nest.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
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
  const baseUrl = trimEndCharacters(appUrl.trim(), "/");
  return baseUrl ? `${baseUrl}${buildWorkspaceEntryHref(workspaceId, destination)}` : "";
}
