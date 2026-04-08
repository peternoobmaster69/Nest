// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailableError,
} from "@/lib/database-errors";

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Login user
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Login user
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    const pool = await getDb();

    const result = await pool
      .request()
      .input("email", email)
      .query(`
        SELECT TOP 1 Id, Email, Phone, Name, PasswordHash
        FROM Users
        WHERE Email = @email;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { error: "invalid email or password" },
        { status: 401 }
      );
    }

    const user = result.recordset[0];

    if (!user.PasswordHash) {
      return NextResponse.json(
        { error: "user has no password set" },
        { status: 401 }
      );
    }

    const match = await bcrypt.compare(password, user.PasswordHash);

    if (!match) {
      return NextResponse.json(
        { error: "invalid email or password" },
        { status: 401 }
      );
    }

    const token = createSessionToken({ userId: user.Id });

    const res = NextResponse.json({
      id: user.Id,
      email: user.Email,
      phone: user.Phone,
      name: user.Name,
    });

    res.cookies.set(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);

    return res;
  } catch (err) {
    console.error("POST /api/auth/login error", err);
    if (isDatabaseUnavailableError(err)) {
      return NextResponse.json(
        {
          error: "database unavailable",
          code: DATABASE_UNAVAILABLE_CODE,
          message: DATABASE_UNAVAILABLE_MESSAGE,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "internal server error" },
      { status: 500 }
    );
  }
}
