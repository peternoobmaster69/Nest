import { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_ID_HEADER, WORKSPACE_PATH_HEADER } from "@/lib/workspace-request";

const LEGACY_WORKSPACE_PATHS = [
  "/admin",
  "/budgets",
  "/collaborators",
  "/credit-alerts",
  "/credit-cards",
  "/credit-transactions",
  "/investments",
  "/profile",
  "/receivables",
  "/rewards",
  "/settings",
  "/transactions",
];

function isLegacyWorkspacePath(pathname: string) {
  return LEGACY_WORKSPACE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function workspaceIdFromPath(pathname: string) {
  const match = /^\/w\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function contentSecurityPolicy(nonce: string) {
  const development = process.env.NODE_ENV === "development";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.vercel-insights.com https://va.vercel-scripts.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!development) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function applySecurityHeaders(response: NextResponse, csp: string, isApi: boolean) {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  if (isApi) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie, Origin");
  }
  return response;
}

function canonicalOrigin(request: NextRequest) {
  const configured = process.env.NEXTAUTH_URL?.trim();
  return configured ? new URL(configured).origin : request.nextUrl.origin;
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const method = request.method.toUpperCase();
  const unsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (!isApi && isLegacyWorkspacePath(request.nextUrl.pathname)) {
    const entryUrl = request.nextUrl.clone();
    const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    entryUrl.pathname = "/entry";
    entryUrl.search = "";
    entryUrl.searchParams.set("next", destination);
    return applySecurityHeaders(NextResponse.redirect(entryUrl), csp, false);
  }

  if (isApi && unsafeMethod) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== canonicalOrigin(request)) || (!origin && fetchSite === "cross-site")) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 }),
        csp,
        true,
      );
    }
  }

  const requestHeaders = new Headers(request.headers);
  const workspaceId = workspaceIdFromPath(request.nextUrl.pathname);
  if (workspaceId) {
    requestHeaders.set(WORKSPACE_ID_HEADER, workspaceId);
    requestHeaders.set(
      WORKSPACE_PATH_HEADER,
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
  }
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, csp, isApi);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|manifest.webmanifest|theme-init.js).*)",
  ],
};
