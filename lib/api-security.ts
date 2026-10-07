import { randomUUID } from "node:crypto";
import { z, ZodError, type ZodType } from "zod";
import { DATABASE_UNAVAILABLE_CODE, isDatabaseWakeTransientError } from "@/lib/database-errors";
import { rateLimitResponse } from "@/lib/security-rate-limit";
import { ApiRequestError, apiErrorCodeForStatus } from "@/lib/api/contracts";
import {
  ApiAuthError,
  requireRecentAuthentication,
  requireWorkspaceAccess,
  type WorkspaceRole,
} from "@/lib/workspace-auth";
import { logEvent } from "@/lib/observability/logger";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export { ApiRequestError } from "@/lib/api/contracts";

function expectedOrigin(request: Request) {
  const configured = process.env.NEXTAUTH_URL?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== expectedOrigin(request)) {
    throw new ApiRequestError(403, "Cross-origin request denied");
  }
  if (!origin && fetchSite === "cross-site") {
    throw new ApiRequestError(403, "Cross-origin request denied");
  }
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new ApiRequestError(415, "Content-Type must be application/json");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new ApiRequestError(413, "Request body is too large");
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
    throw new ApiRequestError(413, "Request body is too large");
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ApiRequestError(400, "Request body must contain valid JSON");
  }
  return schema.parse(input);
}

type SecureApiOptions = {
  mutation?: boolean;
  noStore?: boolean;
  errorMessage?: string;
  auth?: {
    workspaceId?: string | null;
    minimumRole?: WorkspaceRole;
    recent?: boolean;
  };
};

type SecureApiContext = {
  requestId: string;
  auth?: Awaited<ReturnType<typeof requireWorkspaceAccess>>;
};

function secureHeaders(response: Response, requestId: string, noStore: boolean) {
  response.headers.set("X-Request-Id", requestId);
  if (noStore) response.headers.set("Cache-Control", "no-store");
  const vary = response.headers.get("Vary");
  if (!vary) response.headers.set("Vary", "Cookie");
  else if (!vary.split(",").some((value) => value.trim().toLowerCase() === "cookie")) {
    response.headers.set("Vary", `${vary}, Cookie`);
  }
  return response;
}

async function requireApiAuthentication(options: SecureApiOptions["auth"]) {
  if (!options) return undefined;
  const auth = await requireWorkspaceAccess(options.workspaceId, options.minimumRole ?? "VIEWER");
  if (options.recent) {
    const recentUserId = await requireRecentAuthentication();
    if (recentUserId !== auth.userId) throw new ApiAuthError(401, "Unauthorized");
  }
  return auth;
}

function failureLogLevel(status: number) {
  if (status >= 500) return "error";
  return status === 429 ? "warn" : "info";
}

function knownApiErrorResponse(error: unknown, requestId: string) {
  const limited = rateLimitResponse(error);
  if (limited) return limited;
  if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
    const code = error instanceof ApiRequestError ? error.code : apiErrorCodeForStatus(error.status);
    return Response.json({ error: error.message, code, requestId }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Invalid request", code: "UNPROCESSABLE_ENTITY", issues: z.flattenError(error), requestId },
      { status: 422 },
    );
  }
  if (isDatabaseWakeTransientError(error)) {
    return Response.json(
      { error: "The database is waking up. Please retry shortly.", code: DATABASE_UNAVAILABLE_CODE, requestId },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
  return null;
}

export async function runSecureApiRoute(
  request: Request,
  options: SecureApiOptions,
  handler: (context: SecureApiContext) => Promise<Response>,
) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  try {
    if (options.mutation) assertSameOriginRequest(request);
    const auth = await requireApiAuthentication(options.auth);
    const response = await handler({ requestId, auth });
    logEvent("info", "api.request", {
      requestId,
      workspaceId: auth?.workspaceId,
      method: request.method,
      route: new URL(request.url).pathname,
      status: response.status,
      outcome: response.status >= 500 ? "error" : "success",
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    return secureHeaders(response, requestId, options.noStore ?? true);
  } catch (error) {
    const knownResponse = knownApiErrorResponse(error, requestId);
    const status = knownResponse?.status ?? 500;
    logEvent(failureLogLevel(status), "api.request", {
      requestId,
      method: request.method,
      route: new URL(request.url).pathname,
      status,
      outcome: "error",
      errorType: error instanceof Error ? error.name : "UnknownError",
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    if (knownResponse) return secureHeaders(knownResponse, requestId, true);
    logEvent("error", "api.unhandled_error", {
      requestId,
      method: request.method,
      route: new URL(request.url).pathname,
      status: 500,
      outcome: "error",
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error,
    });
    return secureHeaders(
      Response.json(
        { error: options.errorMessage ?? "Request failed", code: "INTERNAL_ERROR", requestId },
        { status: 500 },
      ),
      requestId,
      true,
    );
  }
}
