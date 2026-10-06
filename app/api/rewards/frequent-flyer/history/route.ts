import { prisma } from "@/lib/prisma";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { listFrequentFlyerHistory } from "@/lib/domains/rewards";
import { ApiRequestError } from "@/lib/api-security";

const CreateEarnSchema = z.object({
  type: z.literal("earn"),
  frequentFlyerId: z.string().min(1),
  date: z.iso.datetime(),
  miles: z.number().int().positive(),
  title: z.string().trim().min(1).optional(),
  expiryDate: z.iso.datetime().optional().nullable(),
  firstRedeemedDate: z.iso.datetime().optional().nullable(),
});

const CreateRedeemSchema = z.object({
  type: z.literal("redeem"),
  frequentFlyerId: z.string().min(1),
  redemptionTitle: z.string().trim().min(1),
  dateTime: z.iso.datetime(),
  milesToRedeem: z.number().int().positive(),
});

const UpdateEarnSchema = z.object({
  type: z.literal("earn"),
  frequentFlyerId: z.string().min(1),
  id: z.string().min(1),
  date: z.iso.datetime().optional(),
  miles: z.number().int().positive().optional(),
  title: z.string().trim().min(1).optional().nullable(),
  expiryDate: z.iso.datetime().optional().nullable(),
  firstRedeemedDate: z.iso.datetime().optional().nullable(),
});

const UpdateRedeemSchema = z.object({
  type: z.literal("redeem"),
  frequentFlyerId: z.string().min(1),
  id: z.string().min(1),
  redemptionTitle: z.string().trim().min(1).optional(),
  dateTime: z.iso.datetime().optional(),
});

const PostSchema = z.union([CreateEarnSchema, CreateRedeemSchema]);
const PatchSchema = z.union([UpdateEarnSchema, UpdateRedeemSchema]);

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function expiryLastDayOfEarnMonth(earnDate: string, years: number): Date {
  const date = new Date(earnDate);
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth() + 1, 0));
}

async function ensureFrequentFlyer(workspaceId: string, frequentFlyerId: string) {
  const frequentFlyer = await prisma.frequentFlyerAccount.findFirst({
    where: { id: frequentFlyerId, workspaceId, isActive: true },
    select: { id: true, programName: true, mileNeverExpire: true, validityPeriodYears: true },
  });
  if (!frequentFlyer) {
    throw new Error("Frequent flyer account not found");
  }
  return frequentFlyer;
}

function startOfTodayUtc() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

async function syncCurrentMiles(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  frequentFlyerId: string,
) {
  const today = startOfTodayUtc();
  const aggregate = await tx.mileProgram.aggregate({
    where: {
      workspaceId,
      frequentFlyerId,
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    },
    _sum: { balanceMiles: true },
  });
  await tx.frequentFlyerAccount.update({
    where: { id: frequentFlyerId },
    data: { currentMiles: aggregate._sum.balanceMiles ?? 0 },
  });
}

async function createRedemptionWithAutoAllocation(params: {
  tx: Prisma.TransactionClient;
  workspaceId: string;
  frequentFlyerId: string;
  redemptionTitle: string;
  dateTime: Date;
  milesToRedeem: number;
}) {
  const { tx, workspaceId, frequentFlyerId, redemptionTitle, dateTime, milesToRedeem } = params;

  const sources = await tx.mileProgram.findMany({
    take: 5_000,
    where: {
      workspaceId,
      frequentFlyerId,
      balanceMiles: { gt: 0 },
    },
    orderBy: [{ expiryDate: "asc" }, { date: "asc" }, { createdAt: "asc" }],
    select: { id: true, balanceMiles: true, firstRedeemedDate: true },
  });

  let remaining = milesToRedeem;
  const allocations: Array<{ milesFileId: string; milesRedeemed: number }> = [];
  for (const source of sources) {
    if (remaining <= 0) break;
    const used = Math.min(source.balanceMiles, remaining);
    if (used <= 0) continue;
    allocations.push({ milesFileId: source.id, milesRedeemed: used });
    remaining -= used;
  }

  if (remaining > 0) {
    throw new Error("Not enough available miles for redemption");
  }

  const redemption = await tx.mileRedemption.create({
    data: {
      workspaceId,
      frequentFlyerId,
      redemptionTitle,
      totalMilesRedeemed: milesToRedeem,
      dateTime,
    },
    select: { id: true },
  });

  for (const allocation of allocations) {
    await tx.mileRedemptionDetail.create({
      data: {
        redemptionId: redemption.id,
        milesFileId: allocation.milesFileId,
        milesRedeemed: allocation.milesRedeemed,
      },
    });
    await tx.mileProgram.update({
      where: { id: allocation.milesFileId },
      data: {
        balanceMiles: { decrement: allocation.milesRedeemed },
        firstRedeemedDate: dateTime,
      },
    });
  }

  await syncCurrentMiles(tx, workspaceId, frequentFlyerId);
}

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess();
    return NextResponse.json(await listFrequentFlyerHistory(workspaceId, request));
  } catch (error) {
    if (error instanceof ApiAuthError || error instanceof ApiRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to fetch transaction history" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
    const body = await request.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: z.flattenError(parsed.error) }, { status: 400 });
    }

    const payload = parsed.data;
    const frequentFlyer = await ensureFrequentFlyer(workspaceId, payload.frequentFlyerId);

    await prisma.$transaction(async (tx) => {
      if (payload.type === "earn") {
        const expiryDate = frequentFlyer.mileNeverExpire
          ? null
          : payload.expiryDate
            ? toDate(payload.expiryDate)
            : expiryLastDayOfEarnMonth(payload.date, frequentFlyer.validityPeriodYears);

        await tx.mileProgram.create({
          data: {
            workspaceId,
            frequentFlyerId: payload.frequentFlyerId,
            date: new Date(payload.date),
            miles: payload.miles,
            balanceMiles: payload.miles,
            title: payload.title ?? null,
            expiryDate,
            firstRedeemedDate: toDate(payload.firstRedeemedDate),
          },
        });
        await syncCurrentMiles(tx, workspaceId, payload.frequentFlyerId);
        return;
      }

      await createRedemptionWithAutoAllocation({
        tx,
        workspaceId,
        frequentFlyerId: payload.frequentFlyerId,
        redemptionTitle: payload.redemptionTitle,
        dateTime: new Date(payload.dateTime),
        milesToRedeem: payload.milesToRedeem,
      });
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create history item" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: z.flattenError(parsed.error) }, { status: 400 });
    }

    const payload = parsed.data;
    await ensureFrequentFlyer(workspaceId, payload.frequentFlyerId);

    await prisma.$transaction(async (tx) => {
      if (payload.type === "earn") {
        const existing = await tx.mileProgram.findFirst({
          where: {
            id: payload.id,
            workspaceId,
            frequentFlyerId: payload.frequentFlyerId,
          },
          select: { miles: true, balanceMiles: true },
        });
        if (!existing) {
          throw new Error("Earn transaction not found");
        }
        const usedMiles = existing.miles - existing.balanceMiles;
        const nextMiles = payload.miles ?? existing.miles;
        if (nextMiles < usedMiles) {
          throw new Error("Miles cannot be reduced below already redeemed amount");
        }

        await tx.mileProgram.update({
          where: { id: payload.id },
          data: {
            date: payload.date ? new Date(payload.date) : undefined,
            title: payload.title === undefined ? undefined : payload.title,
            miles: nextMiles,
            balanceMiles: nextMiles - usedMiles,
            expiryDate: payload.expiryDate === undefined ? undefined : toDate(payload.expiryDate),
            firstRedeemedDate:
              payload.firstRedeemedDate === undefined ? undefined : toDate(payload.firstRedeemedDate),
          },
        });
        await syncCurrentMiles(tx, workspaceId, payload.frequentFlyerId);
        return;
      }

      const existing = await tx.mileRedemption.findFirst({
        where: {
          id: payload.id,
          workspaceId,
          frequentFlyerId: payload.frequentFlyerId,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new Error("Redemption transaction not found");
      }

      await tx.mileRedemption.update({
        where: { id: payload.id },
        data: {
          redemptionTitle: payload.redemptionTitle ?? undefined,
          dateTime: payload.dateTime ? new Date(payload.dateTime) : undefined,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update history item" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { workspaceId } = await requireWorkspaceAccess(null, "EDITOR");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const type = searchParams.get("type");
    const frequentFlyerId = searchParams.get("frequentFlyerId");

    if (!id || !type || !frequentFlyerId) {
      return NextResponse.json(
        { error: "id, type and frequentFlyerId are required" },
        { status: 400 },
      );
    }

    await ensureFrequentFlyer(workspaceId, frequentFlyerId);

    await prisma.$transaction(async (tx) => {
      if (type === "earn") {
        const existing = await tx.mileProgram.findFirst({
          where: { id, workspaceId, frequentFlyerId },
          select: { id: true },
        });
        if (!existing) {
          throw new Error("Earn transaction not found");
        }
        const usageCount = await tx.mileRedemptionDetail.count({ where: { milesFileId: id } });
        if (usageCount > 0) {
          throw new Error("Cannot delete an earn transaction that has redemption allocations");
        }
        await tx.mileProgram.delete({ where: { id } });
        await syncCurrentMiles(tx, workspaceId, frequentFlyerId);
        return;
      }

      if (type !== "redeem") {
        throw new Error("Invalid type");
      }

      const redemption = await tx.mileRedemption.findFirst({
        where: { id, workspaceId, frequentFlyerId },
        include: { details: true },
      });
      if (!redemption) {
        throw new Error("Redemption transaction not found");
      }

      for (const detail of redemption.details) {
        await tx.mileProgram.update({
          where: { id: detail.milesFileId },
          data: { balanceMiles: { increment: detail.milesRedeemed } },
        });
      }
      await tx.mileRedemption.delete({ where: { id } });
      await syncCurrentMiles(tx, workspaceId, frequentFlyerId);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to delete history item" }, { status: 500 });
  }
}
