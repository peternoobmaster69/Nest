import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api-security";
import { decodeCursor, toListEnvelope, MAX_CURSOR_LENGTH } from "@/lib/api/pagination";

const RewardHistoryQuerySchema = z.object({
  frequentFlyerId: z.string().trim().min(1).max(191),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  earnCursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
  redemptionCursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

function cursorDate(value: string | undefined) {
  if (!value) return null;
  try {
    const cursor = decodeCursor(value);
    const date = new Date(cursor.sortValue);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid cursor");
    return { ...cursor, date };
  } catch {
    throw new ApiRequestError(400, "Invalid history cursor");
  }
}

function startOfTodayUtc() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

export async function listFrequentFlyerHistory(workspaceId: string, request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = RewardHistoryQuerySchema.safeParse({
    frequentFlyerId: params.get("frequentFlyerId"),
    limit: params.get("limit") || undefined,
    earnCursor: params.get("earnCursor") || undefined,
    redemptionCursor: params.get("redemptionCursor") || undefined,
  });
  if (!parsed.success) {
    throw new ApiRequestError(422, "Invalid reward history query", "UNPROCESSABLE_ENTITY");
  }
  const query = parsed.data;
  const earnCursor = cursorDate(query.earnCursor);
  const redemptionCursor = cursorDate(query.redemptionCursor);

  const frequentFlyer = await prisma.frequentFlyerAccount.findFirst({
    where: { id: query.frequentFlyerId, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!frequentFlyer) throw new ApiRequestError(404, "Frequent flyer account not found");

  const today = startOfTodayUtc();
  const [milePrograms, redemptions, earnedTotals, availableTotals, redeemedTotals] = await Promise.all([
    prisma.mileProgram.findMany({
      where: {
        workspaceId,
        frequentFlyerId: query.frequentFlyerId,
        ...(earnCursor ? {
          OR: [
            { date: { lt: earnCursor.date } },
            { date: earnCursor.date, id: { lt: earnCursor.id } },
          ],
        } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    prisma.mileRedemption.findMany({
      where: {
        workspaceId,
        frequentFlyerId: query.frequentFlyerId,
        ...(redemptionCursor ? {
          OR: [
            { dateTime: { lt: redemptionCursor.date } },
            { dateTime: redemptionCursor.date, id: { lt: redemptionCursor.id } },
          ],
        } : {}),
      },
      include: {
        details: {
          include: { milesFile: { select: { id: true, title: true, date: true } } },
        },
      },
      orderBy: [{ dateTime: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    prisma.mileProgram.aggregate({
      where: { workspaceId, frequentFlyerId: query.frequentFlyerId },
      _sum: { miles: true },
    }),
    prisma.mileProgram.aggregate({
      where: {
        workspaceId,
        frequentFlyerId: query.frequentFlyerId,
        OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
      },
      _sum: { balanceMiles: true },
    }),
    prisma.mileRedemption.aggregate({
      where: { workspaceId, frequentFlyerId: query.frequentFlyerId },
      _sum: { totalMilesRedeemed: true },
    }),
  ]);

  return {
    milePrograms: toListEnvelope(milePrograms, query.limit, (row) => ({
      id: row.id,
      sortValue: row.date.toISOString(),
    })),
    redemptions: toListEnvelope(redemptions, query.limit, (row) => ({
      id: row.id,
      sortValue: row.dateTime.toISOString(),
    })),
    totals: {
      earned: earnedTotals._sum.miles ?? 0,
      available: availableTotals._sum.balanceMiles ?? 0,
      redeemed: redeemedTotals._sum.totalMilesRedeemed ?? 0,
    },
  };
}
