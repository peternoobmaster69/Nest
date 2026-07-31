import { collectReadinessDiagnostics, isDiagnosticsAuthorized } from "@/lib/observability/health";
import { logEvent } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDiagnosticsAuthorized(request)) {
    return Response.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const dependencies = await collectReadinessDiagnostics();
    const ready = dependencies.database.status === "ready" && dependencies.jobs.expiredLeases === 0;
    return Response.json(
      { status: ready ? "ready" : "degraded", timestamp: new Date().toISOString(), dependencies },
      { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logEvent("error", "health.readiness_failed", { error });
    return Response.json(
      { status: "unavailable", timestamp: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
    );
  }
}
