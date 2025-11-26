import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { requireUser } from "@/lib/session";

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Get Accounts for the current user
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: List of accounts for the current user
 */
export async function GET() {
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const pool = await getDb();
    const result = await pool.request().input("userId", user.Id).query(`
    SELECT
      a.Id,
      a.Name,
      a.Type,
      a.Currency,
      a.InitialAmount,
      a.CreatedAt,
      a.IsActive,
      a.InitialAmount + ISNULL(SUM(t.Amount), 0) AS CurrentAmount
    FROM Accounts a
    LEFT JOIN Transactions t
      ON t.AccountId = a.Id
    WHERE a.UserId = @userId
      AND a.IsActive = 1
    GROUP BY
      a.Id,
      a.Name,
      a.Type,
      a.Currency,
      a.InitialAmount,
      a.CreatedAt,
      a.IsActive
    ORDER BY a.CreatedAt ASC;
      `);

    return NextResponse.json(result.recordset);
  } catch (err) {
    console.error("GET /api/accounts error", err);
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
 *     summary: Create Account for the current user
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Create Account for the current user
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, type, currency, initialAmount } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    const accountId = uuid();

    const pool = await getDb();
    await pool
      .request()
      .input("id", accountId)
      .input("userId", user.Id)
      .input("name", name)
      .input("type", type)
      .input("currency", currency ?? "SGD")
      .input("initialAmount", initialAmount ?? 0)
      .input("isActive", true).query(`
        INSERT INTO Accounts (
          Id, UserId, Name, Type, Currency, InitialAmount, CreatedAt, IsActive
        )
        VALUES (
          @id, @userId, @name, @type, @currency, @initialAmount, SYSUTCDATETIME(), @isActive
        );
      `);

    return NextResponse.json({ id: accountId }, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounts error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
