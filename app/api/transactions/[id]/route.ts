// app/api/transactions/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";

type Params = {
  params: Promise<{ id: string }>;
};

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Delete Transaction by ID
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Delete Transaction by ID
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolvedParams = await params;
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    console.debug("DELETE /api/transactions", { txId: resolvedParams.id, userId: user.Id });

    const pool = await getDb();

    const result = await pool
      .request()
      .input("txId", resolvedParams.id)
      .input("userId", user.Id)
      .query(`
        DELETE t
        FROM Transactions t
        INNER JOIN Accounts a ON a.Id = t.AccountId
        WHERE t.Id = @txId
          AND a.UserId = @userId;

        SELECT @@ROWCOUNT AS RowsAffected;
      `);

    const rows = result.recordset[0]?.RowsAffected ?? 0;

    console.debug("DELETE result rows", { txId: resolvedParams.id, rows });
    if (rows === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("DELETE /api/transactions/[id] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Update Transaction by ID
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Update Transaction by ID
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { amount, type, category, date, note } = body;

    if (amount === undefined || !type || !category || !date) {
      return NextResponse.json(
        { error: "missing required fields" },
        { status: 400 }
      );
    }

    const pool = await getDb();

    const resolvedParams = await params;

    // Ensure tx belongs to this user (via Accounts.UserId)
    const result = await pool
      .request()
      .input("txId", resolvedParams.id)
      .input("userId", user.Id)
      .input("amount", amount)
      .input("type", type)
      .input("category", category)
      .input("date", date)
      .input("note", note ?? null)
      .query(`
        UPDATE t
        SET
          Amount   = @amount,
          Type     = @type,
          Category = @category,
          Date     = @date,
          Note     = @note
        FROM Transactions t
        INNER JOIN Accounts a ON a.Id = t.AccountId
        WHERE t.Id = @txId
          AND a.UserId = @userId;

        SELECT TOP 1
          t.Id,
          t.AccountId,
          t.Amount,
          t.Type,
          t.Category,
          t.Date,
          t.Note,
          t.CreatedAt
        FROM Transactions t
        INNER JOIN Accounts a ON a.Id = t.AccountId
        WHERE t.Id = @txId
          AND a.UserId = @userId;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err) {
    console.error("PUT /api/transactions/[id] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
