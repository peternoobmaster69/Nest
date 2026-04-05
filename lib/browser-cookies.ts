"use client";

export function getBrowserCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const encodedName = encodeURIComponent(name);
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (!part.startsWith(`${encodedName}=`)) continue;
    return decodeURIComponent(part.slice(encodedName.length + 1));
  }
  return null;
}

export function setBrowserCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 365) {
  if (typeof document === "undefined") return;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}
