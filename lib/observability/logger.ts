type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const SENSITIVE_KEY_PARTS = [
  "authorization", "cookie", "token", "secret", "password", "passphrase",
  "cvv", "cvc", "pan", "card", "rawbody", "rawemail", "sql", "query",
  "param", "p256dh", "endpoint", "credential",
];
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[a-z\d._~+/-]+=*/gi;
const CARD_NUMBER = /\b(?:\d[ -]*?){13,19}\b/g;
const MAX_STRING_LENGTH = 1_000;

function redactString(value: string) {
  return value
    .replace(BEARER, "[REDACTED_BEARER]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(CARD_NUMBER, "[REDACTED_CARD]")
    .slice(0, MAX_STRING_LENGTH);
}

export function redactTelemetry(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  const normalizedKey = key.toLowerCase();
  if (SENSITIVE_KEY_PARTS.some((part) => normalizedKey.includes(part))) return "[REDACTED]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactString(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const errorCode = (value as unknown as { code?: unknown }).code;
    return {
      name: value.name,
      message: redactString(value.message),
      code: typeof errorCode === "string" ? errorCode : undefined,
    };
  }
  if (typeof value === "function") return "[FUNCTION]";
  if (typeof value === "symbol") return redactString(value.toString());
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactTelemetry(item, key, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([childKey, childValue]) => [childKey, redactTelemetry(childValue, childKey, seen)]),
  );
}

export function logEvent(level: LogLevel, event: string, context: LogContext = {}) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "nest-web",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    ...redactTelemetry(context) as LogContext,
  });
  const output = { error: console.error, warn: console.warn, info: console.info, debug: console.info }[level];
  output(entry);
}

export function observeDuration(
  event: string,
  startedAt: number,
  context: LogContext & { outcome: "success" | "error" },
) {
  logEvent(context.outcome === "error" ? "error" : "info", event, {
    ...context,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  });
}
