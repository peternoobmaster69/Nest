import { timingSafeEqual } from "node:crypto";

export type CronAuthorization =
  | { authorized: true }
  | { authorized: false; status: 401 | 503; error: string };

export function authorizeCronRequest(request: Request): CronAuthorization {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return { authorized: false, status: 503, error: "Scheduler is not configured" };
  }

  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const supplied = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);

  return matches
    ? { authorized: true }
    : { authorized: false, status: 401, error: "Unauthorized" };
}
