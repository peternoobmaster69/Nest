import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_TRANSACTION_LINEAGE_VERSIONS = 50;

const lineageVersionSelect = Prisma.validator<Prisma.TransactionSelect>()({
  id: true,
  subject: true,
  amountCents: true,
  direction: true,
  kind: true,
  date: true,
  details: true,
  notes: true,
  createdAt: true,
  voidedAt: true,
  budget: { select: { id: true, name: true } },
  group: { select: { id: true, name: true, icon: true } },
  postingGroup: {
    select: {
      operation: true,
      sourceType: true,
      sourceId: true,
      actorUserId: true,
      reason: true,
      createdAt: true,
      transactions: {
        where: { kind: "REVERSAL" },
        orderBy: { createdAt: "asc" },
        take: 10,
        select: {
          id: true,
          reversalOfId: true,
          amountCents: true,
          direction: true,
          date: true,
          createdAt: true,
        },
      },
    },
  },
});

type LineageVersionRow = Prisma.TransactionGetPayload<{ select: typeof lineageVersionSelect }>;

function correctionPostingGroup(row: LineageVersionRow) {
  const postingGroup = row.postingGroup;
  if (
    postingGroup?.operation !== "TRANSACTION_CORRECTION" ||
    postingGroup.sourceType !== "TRANSACTION" ||
    !postingGroup.sourceId
  ) {
    return null;
  }
  return postingGroup;
}

function normalizedDirection(direction: string): "CREDIT" | "DEBIT" {
  return direction === "CREDIT" ? "CREDIT" : "DEBIT";
}

export async function readTransactionLineage(params: {
  transactionId: string;
  workspaceId: string;
}) {
  const newestFirst: LineageVersionRow[] = [];
  const seen = new Set<string>();
  let versionId: string | null = params.transactionId;

  while (versionId && newestFirst.length < MAX_TRANSACTION_LINEAGE_VERSIONS) {
    if (seen.has(versionId)) throw new Error("Transaction lineage contains a cycle.");
    seen.add(versionId);

    const row: LineageVersionRow | null = await prisma.transaction.findFirst({
      where: { id: versionId, workspaceId: params.workspaceId },
      select: lineageVersionSelect,
    });
    if (!row) throw new Error("Transaction lineage is incomplete.");

    newestFirst.push(row);
    versionId = correctionPostingGroup(row)?.sourceId ?? null;
  }

  const chronological = [...newestFirst].reverse();
  const actorUserIds = [...new Set(chronological
    .map((row) => correctionPostingGroup(row)?.actorUserId)
    .filter((value): value is string => Boolean(value)))];
  const actors = actorUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorUserIds } },
        take: MAX_TRANSACTION_LINEAGE_VERSIONS,
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorNameById = new Map(actors.map((actor) => [
    actor.id,
    actor.name || actor.email || "Workspace member",
  ]));

  const versions = chronological.map((row, index) => {
    const postingGroup = correctionPostingGroup(row);
    const reversal = postingGroup?.transactions.find(
      (transaction) => transaction.reversalOfId === postingGroup.sourceId,
    );
    const actorUserId = postingGroup?.actorUserId ?? null;

    return {
      id: row.id,
      version: index + 1,
      status: index === chronological.length - 1 ? "CURRENT" as const : "REPLACED" as const,
      subject: row.subject,
      amountCents: row.amountCents,
      direction: normalizedDirection(row.direction),
      kind: row.kind,
      date: row.date.toISOString(),
      details: row.details,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      replacedAt: row.voidedAt?.toISOString() ?? null,
      budget: row.budget,
      group: row.group,
      correction: postingGroup
        ? {
            reason: postingGroup.reason,
            correctedAt: postingGroup.createdAt.toISOString(),
            correctedBy: actorUserId
              ? actorNameById.get(actorUserId) ?? "Former workspace member"
              : "System",
            reversal: reversal
              ? {
                  id: reversal.id,
                  amountCents: reversal.amountCents,
                  direction: normalizedDirection(reversal.direction),
                  date: reversal.date.toISOString(),
                  postedAt: reversal.createdAt.toISOString(),
                }
              : null,
          }
        : null,
    };
  });

  return {
    rootTransactionId: versions[0]?.id ?? params.transactionId,
    currentTransactionId: params.transactionId,
    correctionCount: versions.filter((version) => version.correction).length,
    truncated: versionId !== null,
    versions,
  };
}
