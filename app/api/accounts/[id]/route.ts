// app/api/accounts/[id]/route.ts
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
 *     summary: Create and update account by ID
 *     tags:
 *       - Accounts
 *     responses:
 *       200:
 *         description: Create and update accounts 
 */export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const resolvedParams = await params;
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const pool = await getDb();
    const result = await pool
      .request()
      .input("id", resolvedParams.id)
      .input("userId", user.Id)
      .query(`
        SELECT TOP 1
          Id,
          UserId,
          Name,
          Type,
          Currency,
          InitialAmount,
          CreatedAt,
          IsActive
        FROM Accounts
        WHERE Id = @id
          AND UserId = @userId;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err) {
    console.error("GET /api/accounts/[id] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const resolvedParams = await params;
    const user = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, type, currency, initialAmount, isActive } = body;

      if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    const pool = await getDb();

    const result = await pool
      .request()
      .input("id", resolvedParams.id)
      .input("userId", user.Id)
      .input("name", name)
      .input("type", type)
      .input("currency", currency ?? "SGD")
      .input("initialAmount", initialAmount ?? 0)
      .input("isActive", isActive ?? true)
      .query(`
        UPDATE Accounts
        SET
          Name = @name,
          Type = @type,
          Currency = @currency,
          InitialAmount = @initialAmount,
          IsActive = @isActive
        WHERE Id = @id
          AND UserId = @userId;

        SELECT TOP 1
          Id,
          UserId,
          Name,
          Type,
          Currency,
          InitialAmount,
          CreatedAt,
          IsActive
        FROM Accounts
        WHERE Id = @id
          AND UserId = @userId;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err) {
    console.error("PUT /api/accounts/[id] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
