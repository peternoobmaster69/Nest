// lib/session.ts
"use server";

import { cookies } from "next/headers";
import { getDb } from "./db";
import { verifySessionToken, SESSION_COOKIE_NAME } from "./auth";

export type User = {
  Id: string;
  Email: string;
  Phone: string;
  Name: string | null;
  CreatedAt: string;
};

export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const pool = await getDb();
  const result = await pool
    .request()
    .input("id", payload.userId)
    .query(`
      SELECT TOP 1 Id, Email, Phone, Name, CreatedAt
      FROM Users
      WHERE Id = @id;
    `);

  if (result.recordset.length === 0) return null;

  return result.recordset[0] as User;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return null;
  return user as User;
}
