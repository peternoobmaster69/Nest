type QueryTelemetryContext = {
  domain: string;
  operation: string;
  workspaceId?: string | null;
  requestId?: string;
  rowCount?: number;
};

export async function withQueryTelemetry<T>(
  context: QueryTelemetryContext,
  query: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await query();
    emitQueryTiming({
      ...context,
      rowCount: context.rowCount ?? estimateRowCount(result),
      durationMs: performance.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (error) {
    emitQueryTiming({ ...context, durationMs: performance.now() - startedAt, outcome: "error" });
    throw error;
  }
}

function estimateRowCount(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.reduce<number>(
    (count, item) => count + (Array.isArray(item) ? item.length : item == null ? 0 : 1),
    0,
  );
}

function emitQueryTiming(
  event: QueryTelemetryContext & { durationMs: number; outcome: "success" | "error" },
) {
  logEvent(event.outcome === "error" ? "error" : "info", "database.query_group", {
    domain: event.domain,
    operation: event.operation,
    workspaceId: event.workspaceId ?? undefined,
    requestId: event.requestId,
    rowCount: event.rowCount,
    durationMs: Math.round(event.durationMs * 10) / 10,
    outcome: event.outcome,
  });
}
import { logEvent } from "@/lib/observability/logger";
