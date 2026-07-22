import { WORKSPACE_ID_HEADER } from "@/lib/workspace-request";
import { getWorkspaceIdFromPathname } from "@/lib/workspace-entry";

export function getCurrentWorkspaceId() {
  if (typeof window === "undefined") return null;
  return getWorkspaceIdFromPathname(window.location.pathname);
}

/**
 * Adds the workspace selected by the current URL to same-origin API requests.
 * The server still performs membership and role authorization for the value.
 */
export function workspaceFetch(input: RequestInfo | URL, init?: RequestInit) {
  const workspaceId = getCurrentWorkspaceId();
  if (!workspaceId) return fetch(input, init);

  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const headers = new Headers(init?.headers ?? request?.headers);
  headers.set(WORKSPACE_ID_HEADER, workspaceId);
  return fetch(input, { ...init, headers });
}

