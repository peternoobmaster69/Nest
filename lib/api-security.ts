import { randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import { isDatabaseWakeTransientError } from "@/lib/database-errors";
import { rateLimitResponse } from "@/lib/security-rate-limit";
import { ApiRequestError, apiErrorCodeForStatus } from "@/lib/api/contracts";
import { DATABASE_UNAVAILABLE_CODE } from "@/lib/database-errors";
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

export async function runSecureApiRoute(
  request: Request,
  options: SecureApiOptions,
  handler: (context: SecureApiContext) => Promise<Response>,
) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  try {
    if (options.mutation) assertSameOriginRequest(request);
    let auth: SecureApiContext["auth"];
    if (options.auth) {
      auth = await requireWorkspaceAccess(
        options.auth.workspaceId,
        options.auth.minimumRole ?? "VIEWER",
      );
      if (options.auth.recent) {
        const recentUserId = await requireRecentAuthentication();
        if (recentUserId !== auth.userId) throw new ApiAuthError(401, "Unauthorized");
      }
    }
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
    const limited = rateLimitResponse(error);
    const status = limited?.status
      ?? (error instanceof ApiAuthError || error instanceof ApiRequestError ? error.status : undefined)
      ?? (error instanceof ZodError ? 422 : undefined)
      ?? (isDatabaseWakeTransientError(error) ? 503 : 500);
    logEvent(status >= 500 ? "error" : status === 429 ? "warn" : "info", "api.request", {
      requestId,
      method: request.method,
      route: new URL(request.url).pathname,
      status,
      outcome: "error",
      errorType: error instanceof Error ? error.name : "UnknownError",
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    if (limited) return secureHeaders(limited, requestId, true);
    if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
      const code = error instanceof ApiRequestError
        ? error.code
        : apiErrorCodeForStatus(error.status);
      return secureHeaders(
        Response.json({ error: error.message, code, requestId }, { status: error.status }),
        requestId,
        true,
      );
    }
    if (error instanceof ZodError) {
      return secureHeaders(
        Response.json(
          { error: "Invalid request", code: "UNPROCESSABLE_ENTITY", issues: error.flatten(), requestId },
          { status: 422 },
        ),
        requestId,
        true,
      );
    }
    if (isDatabaseWakeTransientError(error)) {
      return secureHeaders(
        Response.json(
          {
            error: "The database is waking up. Please retry shortly.",
            code: DATABASE_UNAVAILABLE_CODE,
            requestId,
          },
          { status: 503, headers: { "Retry-After": "5" } },
        ),
        requestId,
        true,
      );
    }
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
