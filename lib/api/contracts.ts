const API_ERROR_CODES = {
  400: "INVALID_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export type ApiErrorEnvelope = {
  error: string;
  code: string;
  requestId?: string;
  issues?: unknown;
};

export class ApiRequestError extends Error {
  readonly name = "ApiRequestError";

  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = apiErrorCodeForStatus(status),
  ) {
    super(message);
  }
}

type PageInfo = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

export type ListEnvelope<T> = {
  items: T[];
  pageInfo: PageInfo;
};

export const CACHE_POLICIES = {
  privateNoStore: "private, no-store",
  privateShort: "private, max-age=60, stale-while-revalidate=300",
  publicImmutable: "public, max-age=31536000, immutable",
} as const;

export function apiErrorCodeForStatus(status: number): ApiErrorCode {
  return API_ERROR_CODES[status as keyof typeof API_ERROR_CODES] ?? "INTERNAL_ERROR";
}
