import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const ACTIVE_WORKSPACE_COOKIE = "nest-active-workspace";
const ACTIVE_WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function getActiveWorkspaceCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
}

export function setActiveWorkspaceCookie(response: NextResponse, workspaceId: string) {
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
  });
  return response;
}

export function clearActiveWorkspaceCookie(response: NextResponse) {
  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
