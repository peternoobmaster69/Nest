import { assertProductionConfig } from "@/lib/production-config";
import { logEvent } from "@/lib/observability/logger";

export async function register() {
  assertProductionConfig();
}

export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  logEvent("error", "server.unhandled_request_error", {
    error,
    method: request.method,
    route: context.routePath || request.path,
    routerKind: context.routerKind,
    routeType: context.routeType,
  });
}
