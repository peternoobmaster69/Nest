// app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailableError,
} from "@/lib/database-errors";

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Register user
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Register user
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name, phone } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'email and password are required' },
        { status: 400 }
      );
    }

    const pool = await getDb();

    // Check if user exists
    const existing = await pool
      .request()
      .input('email', email)
      .query(`
        SELECT TOP 1 Id FROM Users WHERE Email = @email;
      `);

    if (existing.recordset.length > 0) {
      return NextResponse.json(
        { error: 'email already registered' },
        { status: 409 }
      );
    }

    const userId = uuid();
    const passwordHash = await bcrypt.hash(password, 10);

    await pool
      .request()
      .input('id', userId)
      .input('email', email)
      .input('name', name ?? null)
      .input('phone', phone ?? null)
      .input('passwordHash', passwordHash)
      .query(`
        INSERT INTO Users (Id, Email, Name, Phone, PasswordHash)
        VALUES (@id, @email, @name, @phone, @passwordHash);
      `);

    return NextResponse.json({ id: userId }, { status: 201 });
  } catch (err) {
    console.error('POST /api/auth/register error', err);
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
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
