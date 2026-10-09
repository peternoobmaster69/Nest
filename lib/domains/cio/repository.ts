import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/contracts";
import {
  CIO_MAX_LIST_ITEMS,
  CioExposuresInputSchema,
  CioInvestmentProfileInputSchema,
  CioPlanningPositionCreateSchema,
  CioPlanningPositionUpdateSchema,
  CioPolicyInputSchema,
  CioProfileInputSchema,
  CioRecurringFlowCreateSchema,
  CioRecurringFlowUpdateSchema,
  type CioExposuresInput,
  type CioInvestmentProfileInput,
  type CioPlanningPositionCreateInput,
  type CioPlanningPositionUpdateInput,
  type CioPolicyInput,
  type CioProfileInput,
  type CioRecurringFlowCreateInput,
  type CioRecurringFlowUpdateInput,
} from "./contracts";

export type CioDb = PrismaClient | Prisma.TransactionClient;

function isPrismaClient(db: CioDb): db is PrismaClient {
  return "$transaction" in db && typeof db.$transaction === "function";
}

async function withCioTransaction<T>(
  db: CioDb,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  if (!isPrismaClient(db)) return operation(db);
  return db.$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function optionalDate(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return new Date(value);
}

function requiredDate(value: string) {
  return new Date(value);
}

function auditDetails(entity: string) {
  return `${entity} configuration updated.`;
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorUserId: string,
  action: string,
  entity: string,
) {
  await tx.workspaceAuditLog.create({
    data: { workspaceId, actorUserId, action, details: auditDetails(entity) },
  });
}

async function requireInvestment(
  db: CioDb,
  workspaceId: string,
  investmentAccountId: string,
) {
  const account = await db.investmentAccount.findFirst({
    where: { id: investmentAccountId, workspaceId },
    select: { id: true },
  });
  if (!account) throw new ApiRequestError(404, "Investment account not found");
  return account;
}

function assertHouseholdProfileState(value: {
  planningScope: string;
  primaryBirthDate: Date | null;
  primaryCurrentAge: number | null;
  primaryAgeAsOfDate: Date | null;
  partnerBirthDate: Date | null;
  targetRetirementAge: number | null;
  targetRetirementDate: Date | null;
  bearReturnBps: number | null;
  baseReturnBps: number | null;
  bullReturnBps: number | null;
}) {
  if (value.planningScope !== "INDIVIDUAL" && value.planningScope !== "HOUSEHOLD") {
    throw new ApiRequestError(422, "Planning scope must be individual or household.");
  }
  if (value.planningScope === "INDIVIDUAL" && value.partnerBirthDate) {
    throw new ApiRequestError(422, "Partner birth date is only used for household planning.");
  }
  if (value.primaryBirthDate && value.primaryCurrentAge !== null) {
    throw new ApiRequestError(422, "Use either primary birth date or current age, not both.");
  }
  if ((value.primaryCurrentAge === null) !== (value.primaryAgeAsOfDate === null)) {
    throw new ApiRequestError(422, "Current age and its as-of date must be configured together.");
  }
  if (value.targetRetirementAge !== null && value.targetRetirementDate) {
    throw new ApiRequestError(422, "Use either target retirement age or target date, not both.");
  }
  if (value.bearReturnBps !== null && value.baseReturnBps !== null && value.bearReturnBps > value.baseReturnBps) {
    throw new ApiRequestError(422, "Bear return cannot exceed base return.");
  }
  if (value.baseReturnBps !== null && value.bullReturnBps !== null && value.baseReturnBps > value.bullReturnBps) {
    throw new ApiRequestError(422, "Bull return cannot be below base return.");
  }
}

export async function getCioProfile(workspaceId: string, db: CioDb = prisma) {
  return db.cioHouseholdProfile.findUnique({ where: { workspaceId } });
}

export async function upsertCioProfile(
  params: { workspaceId: string; actorUserId: string; data: CioProfileInput },
  db: CioDb = prisma,
) {
  const input = CioProfileInputSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    const existing = await tx.cioHouseholdProfile.findUnique({ where: { workspaceId: params.workspaceId } });
    const candidate = {
      planningScope: input.planningScope
        ?? (input.partnerBirthDate ? "HOUSEHOLD" : existing?.planningScope)
        ?? "INDIVIDUAL",
      primaryBirthDate: optionalDate(input.primaryBirthDate) ?? existing?.primaryBirthDate ?? null,
      primaryCurrentAge: input.primaryCurrentAge === undefined ? existing?.primaryCurrentAge ?? null : input.primaryCurrentAge,
      primaryAgeAsOfDate: optionalDate(input.primaryAgeAsOfDate) ?? existing?.primaryAgeAsOfDate ?? null,
      partnerBirthDate: optionalDate(input.partnerBirthDate) ?? existing?.partnerBirthDate ?? null,
      targetRetirementAge: input.targetRetirementAge === undefined ? existing?.targetRetirementAge ?? null : input.targetRetirementAge,
      targetRetirementDate: optionalDate(input.targetRetirementDate) ?? existing?.targetRetirementDate ?? null,
      bearReturnBps: input.bearReturnBps === undefined ? existing?.bearReturnBps ?? null : input.bearReturnBps,
      baseReturnBps: input.baseReturnBps === undefined ? existing?.baseReturnBps ?? null : input.baseReturnBps,
      bullReturnBps: input.bullReturnBps === undefined ? existing?.bullReturnBps ?? null : input.bullReturnBps,
    };
    // Preserve explicit nulls, which `??` cannot distinguish from omission.
    if (input.primaryBirthDate === null) candidate.primaryBirthDate = null;
    if (input.primaryAgeAsOfDate === null) candidate.primaryAgeAsOfDate = null;
    if (input.partnerBirthDate === null) candidate.partnerBirthDate = null;
    if (input.targetRetirementDate === null) candidate.targetRetirementDate = null;
    assertHouseholdProfileState(candidate);

    const data = {
      planningScope: candidate.planningScope,
      primaryBirthDate: optionalDate(input.primaryBirthDate),
      primaryCurrentAge: input.primaryCurrentAge,
      primaryAgeAsOfDate: optionalDate(input.primaryAgeAsOfDate),
      partnerBirthDate: optionalDate(input.partnerBirthDate),
      targetRetirementAge: input.targetRetirementAge,
      targetRetirementDate: optionalDate(input.targetRetirementDate),
      targetMonthlyRetirementSpendingCents: input.targetMonthlyRetirementSpendingCents,
      essentialMonthlySpendingCents: input.essentialMonthlySpendingCents,
      minimumImmediateBankCashCents: input.minimumImmediateBankCashCents,
      inflationRateBps: input.inflationRateBps,
      bearReturnBps: input.bearReturnBps,
      baseReturnBps: input.baseReturnBps,
      bullReturnBps: input.bullReturnBps,
      sustainableWithdrawalRateBps: input.sustainableWithdrawalRateBps,
      annualExternalContributionOverrideCents: input.annualExternalContributionOverrideCents,
      contributionGrowthRateBps: input.contributionGrowthRateBps,
    };
    const profile = await tx.cioHouseholdProfile.upsert({
      where: { workspaceId: params.workspaceId },
      create: { workspaceId: params.workspaceId, ...data },
      update: data,
    });
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_PROFILE_UPDATED", "CIO planning profile");
    return profile;
  });
}

const policyInclude = {
  assetClassBands: { orderBy: { assetClass: "asc" as const } },
  geographyLimits: { orderBy: { geography: "asc" as const } },
};

function confirmationTimestamp(value: string | null | undefined) {
  if (value == null) return value;
  return new Date();
}

export async function getCioPolicy(workspaceId: string, db: CioDb = prisma) {
  return db.cioInvestmentPolicy.findUnique({ where: { workspaceId }, include: policyInclude });
}

export async function upsertCioPolicy(
  params: { workspaceId: string; actorUserId: string; data: CioPolicyInput },
  db: CioDb = prisma,
) {
  const input = CioPolicyInputSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    const { assetClassBands, geographyLimits, ...scalarInput } = input;
    const scalarData = {
      ...scalarInput,
      confirmedAt: confirmationTimestamp(scalarInput.confirmedAt),
    };
    const policy = await tx.cioInvestmentPolicy.upsert({
      where: { workspaceId: params.workspaceId },
      create: { workspaceId: params.workspaceId, ...scalarData },
      update: scalarData,
    });
    if (assetClassBands !== undefined) {
      await tx.cioPolicyAssetClassBand.deleteMany({ where: { policyId: policy.id, workspaceId: params.workspaceId } });
      if (assetClassBands.length) {
        await tx.cioPolicyAssetClassBand.createMany({
          data: assetClassBands.map((band) => ({ ...band, workspaceId: params.workspaceId, policyId: policy.id })),
        });
      }
    }
    if (geographyLimits !== undefined) {
      await tx.cioPolicyGeographyLimit.deleteMany({ where: { policyId: policy.id, workspaceId: params.workspaceId } });
      if (geographyLimits.length) {
        await tx.cioPolicyGeographyLimit.createMany({
          data: geographyLimits.map((limit) => ({ ...limit, workspaceId: params.workspaceId, policyId: policy.id })),
        });
      }
    }
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_POLICY_UPDATED", "CIO investment policy");
    return tx.cioInvestmentPolicy.findUniqueOrThrow({ where: { id: policy.id }, include: policyInclude });
  });
}

export async function getCioInvestmentProfile(
  params: { workspaceId: string; investmentAccountId: string },
  db: CioDb = prisma,
) {
  await requireInvestment(db, params.workspaceId, params.investmentAccountId);
  return db.cioInvestmentProfile.findFirst({
    where: { workspaceId: params.workspaceId, investmentAccountId: params.investmentAccountId },
  });
}

export async function upsertCioInvestmentProfile(
  params: { workspaceId: string; investmentAccountId: string; actorUserId: string; data: CioInvestmentProfileInput },
  db: CioDb = prisma,
) {
  const input = CioInvestmentProfileInputSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    await requireInvestment(tx, params.workspaceId, params.investmentAccountId);
    const data = { ...input, lockUntil: optionalDate(input.lockUntil) };
    const profile = await tx.cioInvestmentProfile.upsert({
      where: { investmentAccountId: params.investmentAccountId },
      create: { workspaceId: params.workspaceId, investmentAccountId: params.investmentAccountId, ...data },
      update: data,
    });
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_INVESTMENT_PROFILE_UPDATED", "CIO investment profile");
    return profile;
  });
}

export async function getCioInvestmentExposures(
  params: { workspaceId: string; investmentAccountId: string },
  db: CioDb = prisma,
) {
  await requireInvestment(db, params.workspaceId, params.investmentAccountId);
  const rows = await db.cioInvestmentExposure.findMany({
    where: { workspaceId: params.workspaceId, investmentAccountId: params.investmentAccountId },
    orderBy: [{ dimension: "asc" }, { exposureKey: "asc" }],
    take: 100,
  });
  return rows;
}

export async function replaceCioInvestmentExposures(
  params: { workspaceId: string; investmentAccountId: string; actorUserId: string; data: CioExposuresInput },
  db: CioDb = prisma,
) {
  const input = CioExposuresInputSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    await requireInvestment(tx, params.workspaceId, params.investmentAccountId);
    await tx.cioInvestmentExposure.deleteMany({
      where: { workspaceId: params.workspaceId, investmentAccountId: params.investmentAccountId },
    });
    if (input.exposures.length) {
      await tx.cioInvestmentExposure.createMany({
        data: input.exposures.map((exposure) => ({
          workspaceId: params.workspaceId,
          investmentAccountId: params.investmentAccountId,
          dimension: exposure.dimension,
          exposureKey: exposure.key,
          weightBps: exposure.weightBps,
        })),
      });
    }
    const rows = await tx.cioInvestmentExposure.findMany({
      where: { workspaceId: params.workspaceId, investmentAccountId: params.investmentAccountId },
      orderBy: [{ dimension: "asc" }, { exposureKey: "asc" }],
      take: 100,
    });
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.dimension, (totals.get(row.dimension) ?? 0) + row.weightBps);
    if ([...totals.values()].some((total) => total !== 10_000)) {
      throw new ApiRequestError(422, "Every configured exposure dimension must total exactly 10000 basis points.");
    }
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_INVESTMENT_EXPOSURES_REPLACED", "CIO investment exposures");
    return rows;
  });
}

async function assertFlowReferences(
  db: CioDb,
  workspaceId: string,
  value: {
    sourceFinancialAccountId?: string | null;
    sourceInvestmentAccountId?: string | null;
    destinationInvestmentAccountId?: string | null;
  },
) {
  const checks: Promise<unknown>[] = [];
  if (value.sourceFinancialAccountId) {
    checks.push(db.financialAccount.findFirst({
      where: { id: value.sourceFinancialAccountId, workspaceId },
      select: { id: true },
    }).then((row) => {
      if (!row) throw new ApiRequestError(404, "Source financial account not found");
    }));
  }
  if (value.sourceInvestmentAccountId) {
    checks.push(requireInvestment(db, workspaceId, value.sourceInvestmentAccountId));
  }
  if (value.destinationInvestmentAccountId) {
    checks.push(requireInvestment(db, workspaceId, value.destinationInvestmentAccountId));
  }
  await Promise.all(checks);
}

export async function listCioRecurringFlows(workspaceId: string, db: CioDb = prisma) {
  return db.cioRecurringFlow.findMany({
    where: { workspaceId },
    orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: CIO_MAX_LIST_ITEMS,
  });
}

function flowCreateData(workspaceId: string, input: CioRecurringFlowCreateInput) {
  return {
    workspaceId,
    type: input.type,
    sourceFinancialAccountId: input.sourceFinancialAccountId ?? null,
    sourceInvestmentAccountId: input.sourceInvestmentAccountId ?? null,
    destinationInvestmentAccountId: input.destinationInvestmentAccountId ?? null,
    amountCents: input.amountCents,
    cadence: input.cadence,
    startsOn: requiredDate(input.startsOn),
    endsOn: optionalDate(input.endsOn) ?? null,
    includeInRetirementProjection: input.includeInRetirementProjection,
    label: input.label,
    notes: input.notes ?? null,
  };
}

export async function createCioRecurringFlow(
  params: { workspaceId: string; actorUserId: string; data: CioRecurringFlowCreateInput },
  db: CioDb = prisma,
) {
  const input = CioRecurringFlowCreateSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    const existingCount = await tx.cioRecurringFlow.count({ where: { workspaceId: params.workspaceId } });
    if (existingCount >= CIO_MAX_LIST_ITEMS) {
      throw new ApiRequestError(422, `A workspace can configure at most ${CIO_MAX_LIST_ITEMS} recurring flows.`);
    }
    await assertFlowReferences(tx, params.workspaceId, input);
    const flow = await tx.cioRecurringFlow.create({ data: flowCreateData(params.workspaceId, input) });
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_RECURRING_FLOW_CREATED", "CIO recurring flow");
    return flow;
  });
}

export async function updateCioRecurringFlow(
  params: { workspaceId: string; id: string; actorUserId: string; data: CioRecurringFlowUpdateInput },
  db: CioDb = prisma,
) {
  const patch = CioRecurringFlowUpdateSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    const existing = await tx.cioRecurringFlow.findFirst({ where: { id: params.id, workspaceId: params.workspaceId } });
    if (!existing) throw new ApiRequestError(404, "Recurring flow not found");
    const merged = CioRecurringFlowCreateSchema.parse({
      type: patch.type ?? existing.type,
      sourceFinancialAccountId: patch.sourceFinancialAccountId === undefined ? existing.sourceFinancialAccountId : patch.sourceFinancialAccountId,
      sourceInvestmentAccountId: patch.sourceInvestmentAccountId === undefined ? existing.sourceInvestmentAccountId : patch.sourceInvestmentAccountId,
      destinationInvestmentAccountId: patch.destinationInvestmentAccountId === undefined ? existing.destinationInvestmentAccountId : patch.destinationInvestmentAccountId,
      amountCents: patch.amountCents ?? existing.amountCents,
      cadence: patch.cadence ?? existing.cadence,
      startsOn: patch.startsOn ?? existing.startsOn.toISOString(),
      endsOn: patch.endsOn === undefined ? existing.endsOn?.toISOString() ?? null : patch.endsOn,
      includeInRetirementProjection: patch.includeInRetirementProjection ?? existing.includeInRetirementProjection,
      label: patch.label ?? existing.label,
      notes: patch.notes === undefined ? existing.notes : patch.notes,
    });
    await assertFlowReferences(tx, params.workspaceId, merged);
    const flow = await tx.cioRecurringFlow.update({
      where: { id: existing.id },
      data: flowCreateData(params.workspaceId, merged),
    });
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_RECURRING_FLOW_UPDATED", "CIO recurring flow");
    return flow;
  });
}

export async function deleteCioRecurringFlow(
  params: { workspaceId: string; id: string; actorUserId: string },
  db: CioDb = prisma,
) {
  return withCioTransaction(db, async (tx) => {
    const deleted = await tx.cioRecurringFlow.deleteMany({ where: { id: params.id, workspaceId: params.workspaceId } });
    if (deleted.count !== 1) throw new ApiRequestError(404, "Recurring flow not found");
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_RECURRING_FLOW_DELETED", "CIO recurring flow");
    return { id: params.id };
  });
}

export async function listCioPlanningPositions(workspaceId: string, db: CioDb = prisma) {
  return db.cioPlanningPosition.findMany({
    where: { workspaceId },
    orderBy: [{ asOfDate: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    take: CIO_MAX_LIST_ITEMS,
  });
}

function positionCreateData(workspaceId: string, input: CioPlanningPositionCreateInput) {
  return {
    workspaceId,
    side: input.side,
    category: input.category,
    label: input.label,
    currentValueCents: input.currentValueCents,
    asOfDate: requiredDate(input.asOfDate),
    liquidityClass: input.liquidityClass,
    includeInInvestableAllocation: input.includeInInvestableAllocation,
    includeInRetirementProjection: input.includeInRetirementProjection,
    notes: input.notes ?? null,
  };
}

export async function createCioPlanningPosition(
  params: { workspaceId: string; actorUserId: string; data: CioPlanningPositionCreateInput },
  db: CioDb = prisma,
) {
  const input = CioPlanningPositionCreateSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    const existingCount = await tx.cioPlanningPosition.count({ where: { workspaceId: params.workspaceId } });
    if (existingCount >= CIO_MAX_LIST_ITEMS) {
      throw new ApiRequestError(422, `A workspace can configure at most ${CIO_MAX_LIST_ITEMS} planning positions.`);
    }
    const position = await tx.cioPlanningPosition.create({ data: positionCreateData(params.workspaceId, input) });
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_PLANNING_POSITION_CREATED", "CIO planning position");
    return position;
  });
}

export async function updateCioPlanningPosition(
  params: { workspaceId: string; id: string; actorUserId: string; data: CioPlanningPositionUpdateInput },
  db: CioDb = prisma,
) {
  const patch = CioPlanningPositionUpdateSchema.parse(params.data);
  return withCioTransaction(db, async (tx) => {
    const existing = await tx.cioPlanningPosition.findFirst({ where: { id: params.id, workspaceId: params.workspaceId } });
    if (!existing) throw new ApiRequestError(404, "Planning position not found");
    const merged = CioPlanningPositionCreateSchema.parse({
      side: patch.side ?? existing.side,
      category: patch.category ?? existing.category,
      label: patch.label ?? existing.label,
      currentValueCents: patch.currentValueCents ?? existing.currentValueCents,
      asOfDate: patch.asOfDate ?? existing.asOfDate.toISOString(),
      liquidityClass: patch.liquidityClass ?? existing.liquidityClass,
      includeInInvestableAllocation: patch.includeInInvestableAllocation ?? existing.includeInInvestableAllocation,
      includeInRetirementProjection: patch.includeInRetirementProjection ?? existing.includeInRetirementProjection,
      notes: patch.notes === undefined ? existing.notes : patch.notes,
    });
    const position = await tx.cioPlanningPosition.update({
      where: { id: existing.id },
      data: positionCreateData(params.workspaceId, merged),
    });
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_PLANNING_POSITION_UPDATED", "CIO planning position");
    return position;
  });
}

export async function deleteCioPlanningPosition(
  params: { workspaceId: string; id: string; actorUserId: string },
  db: CioDb = prisma,
) {
  return withCioTransaction(db, async (tx) => {
    const deleted = await tx.cioPlanningPosition.deleteMany({ where: { id: params.id, workspaceId: params.workspaceId } });
    if (deleted.count !== 1) throw new ApiRequestError(404, "Planning position not found");
    await writeAudit(tx, params.workspaceId, params.actorUserId, "CIO_PLANNING_POSITION_DELETED", "CIO planning position");
    return { id: params.id };
  });
}

export async function loadCioSnapshotData(
  params: { workspaceId: string; asOfDate: Date },
  db: CioDb = prisma,
) {
  const dayStart = new Date(Date.UTC(
    params.asOfDate.getUTCFullYear(),
    params.asOfDate.getUTCMonth(),
    params.asOfDate.getUTCDate(),
  ));
  const dayEndExclusive = new Date(dayStart);
  dayEndExclusive.setUTCDate(dayEndExclusive.getUTCDate() + 1);

  const [workspace, bankControls, savingsSubAccounts, investments, householdProfile, investmentPolicy, planningPositions, recurringFlows] = await Promise.all([
    db.workspace.findUnique({ where: { id: params.workspaceId }, select: { id: true, baseCurrency: true } }),
    db.financialAccount.findMany({
      where: { workspaceId: params.workspaceId, kind: "BANK", isActive: true },
      select: { id: true, startingCents: true, updatedAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CIO_MAX_LIST_ITEMS + 1,
    }),
    db.budgetEnvelope.findMany({
      where: { workspaceId: params.workspaceId, isActive: true, isSavings: true },
      select: { id: true, availableCents: true, updatedAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CIO_MAX_LIST_ITEMS + 1,
    }),
    db.investmentAccount.findMany({
      where: { workspaceId: params.workspaceId, inceptionDate: { lt: dayEndExclusive } },
      orderBy: [{ inceptionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: CIO_MAX_LIST_ITEMS + 1,
      select: {
        id: true,
        displayName: true,
        productName: true,
        institutionName: true,
        isLiquid: true,
        cioProfile: true,
        cioExposures: {
          orderBy: [{ dimension: "asc" }, { exposureKey: "asc" }],
          take: 100,
        },
        entries: {
          where: { date: { lt: dayEndExclusive } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 5_000,
          select: { id: true, date: true, createdAt: true, investedCents: true, currentValueCents: true },
        },
      },
    }),
    db.cioHouseholdProfile.findUnique({ where: { workspaceId: params.workspaceId } }),
    db.cioInvestmentPolicy.findUnique({ where: { workspaceId: params.workspaceId }, include: policyInclude }),
    db.cioPlanningPosition.findMany({
      where: { workspaceId: params.workspaceId, asOfDate: { lt: dayEndExclusive } },
      orderBy: [{ asOfDate: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: CIO_MAX_LIST_ITEMS + 1,
    }),
    db.cioRecurringFlow.findMany({
      where: {
        workspaceId: params.workspaceId,
        startsOn: { lt: dayEndExclusive },
        OR: [{ endsOn: null }, { endsOn: { gte: dayStart } }],
      },
      orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: CIO_MAX_LIST_ITEMS + 1,
    }),
  ]);
  if (!workspace) throw new ApiRequestError(404, "Workspace not found");
  const bankControlsAfterAsOf = bankControls.filter((account) => account.updatedAt >= dayEndExclusive);
  const bankControlsAsOf = bankControls.filter((account) => account.updatedAt < dayEndExclusive);
  const savingsSubAccountsAfterAsOf = savingsSubAccounts.filter((account) => account.updatedAt >= dayEndExclusive);
  const savingsSubAccountsAsOf = savingsSubAccounts.filter((account) => account.updatedAt < dayEndExclusive);
  return {
    workspace,
    householdProfile,
    investmentPolicy,
    bankControls: bankControlsAsOf.slice(0, CIO_MAX_LIST_ITEMS),
    bankControlCount: bankControls.length,
    bankControlsAfterAsOfCount: bankControlsAfterAsOf.length,
    savingsSubAccounts: savingsSubAccountsAsOf.slice(0, CIO_MAX_LIST_ITEMS),
    savingsSubAccountCount: savingsSubAccounts.length,
    savingsSubAccountsAfterAsOfCount: savingsSubAccountsAfterAsOf.length,
    investments: investments.slice(0, CIO_MAX_LIST_ITEMS),
    planningPositions: planningPositions.slice(0, CIO_MAX_LIST_ITEMS),
    recurringFlows: recurringFlows.slice(0, CIO_MAX_LIST_ITEMS),
    truncated: {
      bankControls: bankControls.length > CIO_MAX_LIST_ITEMS,
      savingsSubAccounts: savingsSubAccounts.length > CIO_MAX_LIST_ITEMS,
      investments: investments.length > CIO_MAX_LIST_ITEMS,
      planningPositions: planningPositions.length > CIO_MAX_LIST_ITEMS,
      recurringFlows: recurringFlows.length > CIO_MAX_LIST_ITEMS,
    },
  };
}

export type CioSnapshotData = Awaited<ReturnType<typeof loadCioSnapshotData>>;
