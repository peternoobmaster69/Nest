import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { v4 as uuid } from "uuid";

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Create Transaction
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Create Transaction
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { accountId, amount, type, category, date, note } = body;

    if (!accountId || amount === undefined || !type || !category || !date) {
      return NextResponse.json(
        { error: "missing required fields" },
        { status: 400 }
      );
    }

    const pool = await getDb();

    // Ensure account belongs to this user
    const accResult = await pool
      .request()
      .input("accountId", accountId)
      .input("userId", user.Id)
      .query(`
        SELECT TOP 1 Id
        FROM Accounts
        WHERE Id = @accountId
          AND UserId = @userId
          AND IsActive = 1;
      `);

    if (accResult.recordset.length === 0) {
      return NextResponse.json(
        { error: "account not found" },
        { status: 404 }
      );
    }

    const txId = uuid();

    const result = await pool
      .request()
      .input("id", txId)
      .input("accountId", accountId)
      .input("amount", amount)
      .input("type", type)
      .input("category", category)
      .input("date", date)
      .input("note", note ?? null)
      .query(`
        INSERT INTO Transactions (
          Id, AccountId, Amount, Type, Category, Date, Note, CreatedAt
        )
        VALUES (
          @id, @accountId, @amount, @type, @category, @date, @note, SYSUTCDATETIME()
        );

        SELECT TOP 1
          Id,
          AccountId,
          Amount,
          Type,
          Category,
          Date,
          Note,
          CreatedAt
        FROM Transactions
        WHERE Id = @id;
      `);

    const tx = result.recordset[0];

    return NextResponse.json(tx, { status: 201 });
  } catch (err) {
    console.error("POST /api/transactions error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
