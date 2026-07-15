type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 5 * 60 * 1_000;
const MAX_REQUESTS = 12;

const globalForAskNestRateLimit = globalThis as unknown as {
  askNestRateLimits?: Map<string, RateLimitBucket>;
};

const buckets = globalForAskNestRateLimit.askNestRateLimits ?? new Map<string, RateLimitBucket>();
globalForAskNestRateLimit.askNestRateLimits = buckets;

export function consumeAskNestRateLimit(userId: string, now = Date.now()) {
  const current = buckets.get(userId);
  if (!current || current.resetAt <= now) {
    const resetAt = now + WINDOW_MS;
    buckets.set(userId, { count: 1, resetAt });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt };
  }

  if (current.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - current.count, resetAt: current.resetAt };
}
