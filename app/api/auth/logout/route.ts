import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Logout user
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Logout user
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });

  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}
