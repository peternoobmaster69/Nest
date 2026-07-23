import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api-security";
import { decodeCursor, parseListQuery, toListEnvelope } from "@/lib/api/pagination";

export async function listCardAlerts(workspaceId: string, request: Request) {
  const query = parseListQuery(request, { defaultLimit: 25, maxLimit: 100 });
  let cursor: ReturnType<typeof decodeCursor> | null = null;
  if (query.cursor) {
    try {
      cursor = decodeCursor(query.cursor);
    } catch {
      throw new ApiRequestError(400, "Invalid alert cursor");
    }
  }
  const cursorDate = cursor ? new Date(cursor.sortValue) : null;
  if (cursorDate && Number.isNaN(cursorDate.getTime())) {
    throw new ApiRequestError(400, "Invalid alert cursor");
  }

  const rows = await prisma.cardAlertStaging.findMany({
    where: {
      workspaceId,
      ...(cursor && cursorDate ? {
        OR: [
          { createdAt: { lt: cursorDate } },
          { createdAt: cursorDate, id: { lt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: {
      id: true,
      source: true,
      bankName: true,
      transactionRef: true,
      currency: true,
      amountCents: true,
      transactionDate: true,
      merchant: true,
      cardLast4: true,
      parseStatus: true,
      failureReason: true,
      creditCardId: true,
      creditTransactionId: true,
      createdAt: true,
      processedAt: true,
    },
  });
  return toListEnvelope(rows, query.limit, (row) => ({
    id: row.id,
    sortValue: row.createdAt.toISOString(),
  }));
}

