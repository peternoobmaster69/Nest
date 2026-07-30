import { apiErrorCodeForStatus, type ApiErrorCode, type ApiErrorEnvelope } from "@/lib/api/contracts";
import { workspaceFetch } from "@/lib/workspace-client";

export class ApiClientError extends Error {
  readonly name = "ApiClientError";

  constructor(
    message: string,
    public readonly status: number,
    public readonly code: ApiErrorCode | string,
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number,
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await workspaceFetch(input, init);
  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null) as (Partial<ApiErrorEnvelope> & { message?: unknown }) | T | null;

  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object" ? payload as Partial<ApiErrorEnvelope> & { message?: unknown } : null;
    const message = typeof errorPayload?.message === "string"
      ? errorPayload.message
      : typeof errorPayload?.error === "string"
        ? errorPayload.error
        : `Request failed (${response.status})`;
    const code = typeof errorPayload?.code === "string"
      ? errorPayload.code
      : apiErrorCodeForStatus(response.status);
    throw new ApiClientError(
      message,
      response.status,
      code,
      errorPayload?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      parseRetryAfter(response.headers.get("retry-after")),
      errorPayload?.issues,
    );
  }

  return payload as T;
}

export type MutationFailureKind = "offline" | "permission" | "conflict" | "stale" | "validation" | "unknown";

export function classifyMutationFailure(error: unknown): MutationFailureKind {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  if (!(error instanceof ApiClientError)) return "unknown";
  if (error.status === 401 || error.status === 403) return "permission";
  if (error.status === 409) return "conflict";
  if (error.status === 412) return "stale";
  if (error.status === 422) return "validation";
  if (error.status === 503) return "offline";
  return "unknown";
}

export function mutationFailureMessage(error: unknown): string {
  const fallback = error instanceof Error ? error.message : "The action could not be completed.";
  switch (classifyMutationFailure(error)) {
    case "offline":
      return "You appear to be offline. Your changes were not submitted.";
    case "permission":
      return "You do not have permission to make this change.";
    case "conflict":
      return "This record changed elsewhere. Refresh it and try again.";
    case "stale":
      return "This form is out of date. Refresh it before saving.";
    default:
      return fallback;
  }
}
