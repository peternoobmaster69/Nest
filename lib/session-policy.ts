export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const ACTIVE_SESSION_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getActiveSessionExpiry(now: Date) {
  return new Date(now.getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000);
}
