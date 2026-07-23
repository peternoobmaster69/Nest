import { apiErrorCodeForStatus, type ApiErrorCode, type ApiErrorEnvelope } from "@/lib/api/contracts";
import { workspaceFetch } from "@/lib/workspace-client";

export const HANDLED_API_ERROR_STATUSES = [401, 403, 409, 422, 429, 503] as const;

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

export function isApiClientError(error: unknown, ...statuses: number[]): error is ApiClientError {
  return error instanceof ApiClientError && (statuses.length === 0 || statuses.includes(error.status));
}
