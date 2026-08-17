import { ApiRequestError } from "@/lib/api/contracts";
import { calculateAnnualInvestmentContributions } from "@/lib/investment-entry-order";
import {
  calculateAllocation,
  calculateLiquidityTotals,
  type AllocationSource,
  type WeightedExposureSlice,
} from "./allocation-engine";
import {
  calculateEmergencyRunway,
  summarizeRecurringFlows,
} from "./cashflow-engine";
import { calculateCioContributionProgress } from "./contribution-progress";
import {
  CioRetirementProjectionInputSchema,
  type CioRetirementProjectionInput,
} from "./contracts";
import { assessCioDataQuality, differenceInUtcDays } from "./data-quality";
import { evaluateCioPolicy } from "./policy-engine";
import {
  loadCioSnapshotData,
  type CioDb,
  type CioSnapshotData,
} from "./repository";
import {
  projectRetirement,
  RetirementProjectionValidationError,
  type RetirementProjectionResult,
} from "./retirement-projection";
import {
  CIO_ASSET_CLASSES,
  type CioAllocationBucket,
  type CioAllocationSummary,
  type CioEvidenceRef,
  type CioLiquidityClass,
  type CioRetirementProjection,
  type CioRetirementProjectionPoint,
  type CioRetirementStatus,
  type CioSnapshot,
} from "./types";

function normalizeAsOfDate(value?: string | Date) {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const dateOnlyValue = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(dateOnlyValue ? `${dateOnlyValue}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime()) || (dateOnlyValue && parsed.toISOString().slice(0, 10) !== dateOnlyValue)) {
    throw new ApiRequestError(422, "Invalid CIO as-of date");
  }
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function safeSum(values: readonly number[], field: string) {
  const result = values.reduce((sum, value) => sum + BigInt(value), BigInt(0));
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ApiRequestError(422, `${field} exceeds the supported calculation range`);
  }
  return Number(result);
}

function exposureSlices(
  exposures: CioSnapshotData["investments"][number]["cioExposures"],
  dimension: "ASSET_CLASS" | "GEOGRAPHY" | "SECURITY",
): WeightedExposureSlice[] | undefined {
  const rows = exposures
    .filter((exposure) => exposure.dimension === dimension)
    .map((exposure) => ({ key: exposure.exposureKey, weightBps: exposure.weightBps }));
  return rows.length > 0 && rows.reduce((sum, row) => sum + row.weightBps, 0) === 10_000
    ? rows
    : undefined;
}

function allocationBuckets(
  buckets: readonly { key: string; valueCents: number; allocationBps: number }[],
  sourceAllocations: readonly { key: string; sourceId: string }[],
): CioAllocationBucket[] {
  const sourceIdsByKey = new Map<string, Set<string>>();
  for (const source of sourceAllocations) {
    const sourceIds = sourceIdsByKey.get(source.key) ?? new Set<string>();
    sourceIds.add(source.sourceId);
    sourceIdsByKey.set(source.key, sourceIds);
  }
  return buckets.map((bucket) => ({
    ...bucket,
    sourceCount: sourceIdsByKey.get(bucket.key)?.size ?? 0,
    isUnknown: bucket.key === "UNKNOWN",
  }));
}

function toAllocationSummary(sources: readonly AllocationSource[]): CioAllocationSummary {
  const result = calculateAllocation(sources);
  const allSecurities = allocationBuckets(result.security.buckets, result.security.sourceAllocations);
  const orderedSecurities = [...allSecurities].sort((left, right) =>
    right.valueCents - left.valueCents || left.key.localeCompare(right.key, "en"));
  const selectedSecurities = orderedSecurities.slice(0, 100);
  const unknownSecurity = allSecurities.find((bucket) => bucket.isUnknown);
  if (unknownSecurity && !selectedSecurities.some((bucket) => bucket.key === unknownSecurity.key)) {
    selectedSecurities[selectedSecurities.length - 1] = unknownSecurity;
  }
  const selectedSecurityKeys = new Set(selectedSecurities.map((bucket) => bucket.key));
  const omittedSecurities = allSecurities.filter((bucket) => !selectedSecurityKeys.has(bucket.key));
  return {
    totalCents: result.totalValueCents,
    assetClasses: allocationBuckets(result.assetClass.buckets, result.assetClass.sourceAllocations),
    geographies: allocationBuckets(result.geography.buckets, result.geography.sourceAllocations),
    securities: selectedSecurities,
    securityBucketCount: allSecurities.length,
    securitiesTruncated: selectedSecurities.length < allSecurities.length,
    omittedSecurityValueCents: omittedSecurities.reduce((sum, bucket) => sum + bucket.valueCents, 0),
    omittedSecurityAllocationBps: omittedSecurities.reduce((sum, bucket) => sum + bucket.allocationBps, 0),
  };
}

function normalizeDuplicateLabel(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-SG").replace(/\s+/g, " ") ?? "";
}

function missingHouseholdAssumptions(profile: CioSnapshotData["householdProfile"]) {
  if (!profile) return ["household profile"];
  const missing: string[] = [];
  const hasAgeSource = Boolean(profile.primaryBirthDate)
    || (profile.primaryCurrentAge !== null && profile.primaryAgeAsOfDate !== null);
  const hasRetirementTarget = profile.targetRetirementAge !== null || profile.targetRetirementDate !== null;
  if (!hasAgeSource) missing.push("primary age source");
  if (!hasRetirementTarget) missing.push("retirement target age or date");
  if (profile.targetMonthlyRetirementSpendingCents === null) missing.push("target retirement spending");
  if (profile.essentialMonthlySpendingCents === null) missing.push("essential monthly spending");
  if (profile.inflationRateBps === null) missing.push("inflation assumption");
  if (profile.bearReturnBps === null) missing.push("bear return assumption");
  if (profile.baseReturnBps === null) missing.push("base return assumption");
  if (profile.bullReturnBps === null) missing.push("bull return assumption");
  if (profile.sustainableWithdrawalRateBps === null) missing.push("withdrawal-rate assumption");
  return missing;
}

function ageAtDate(birthDate: Date, date: Date) {
  let age = date.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday = date.getUTCMonth() < birthDate.getUTCMonth()
    || (date.getUTCMonth() === birthDate.getUTCMonth() && date.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function convertProjection(
  result: RetirementProjectionResult,
  profile: CioSnapshotData["householdProfile"],
  currentAge: number | null,
): CioRetirementProjection {
  const scenarioNames = ["bear", "base", "bull"] as const;
  const projectionStartDate = new Date(`${result.assumptions.asOfDate}T00:00:00.000Z`);
  return {
    assumptions: {
      asOfDate: result.assumptions.asOfDate,
      retirementDate: result.assumptions.resolvedTargetRetirementDate,
      horizonYears: result.assumptions.projectionYears,
      currentRetirementAssetsCents: result.assumptions.currentRetirementAssetsCents,
      annualExternalContributionCents: result.assumptions.annualExternalContributionCents,
      contributionGrowthRateBps: result.assumptions.contributionGrowthBps,
      inflationRateBps: result.assumptions.inflationBps,
      bearReturnBps: result.assumptions.bearReturnBps,
      baseReturnBps: result.assumptions.baseReturnBps,
      bullReturnBps: result.assumptions.bullReturnBps,
      targetMonthlySpendingTodayCents: result.assumptions.targetMonthlyRetirementSpendingCents,
      sustainableWithdrawalRateBps: result.assumptions.sustainableWithdrawalRateBps,
      contributionTiming: "END_OF_YEAR",
      finalPeriodFractionBps: result.assumptions.finalPeriodFractionBps,
      horizonRounding: result.assumptions.horizonRounding,
    },
    scenarios: scenarioNames.map((name) => {
      const scenario = result.scenarios[name];
      const points: CioRetirementProjectionPoint[] = scenario.points.map((point) => {
        const date = new Date(`${point.date}T00:00:00.000Z`);
        return {
          date: point.date,
          year: date.getUTCFullYear(),
          age: profile?.primaryBirthDate
            ? ageAtDate(profile.primaryBirthDate, date)
            : currentAge === null ? null : currentAge + ageAtDate(projectionStartDate, date),
          nominalCents: point.nominalValueCents,
          realCents: point.realValueCents,
          annualContributionCents: point.contributionCents,
        };
      });
      return {
        scenario: name.toUpperCase() as "BEAR" | "BASE" | "BULL",
        nominalReturnBps: scenario.nominalReturnBps,
        points,
        fundAtRetirementNominalCents: scenario.outcome.nominalFundCents,
        fundAtRetirementRealCents: scenario.outcome.realFundCents,
        sustainableMonthlyIncomeNominalCents: scenario.outcome.nominalSustainableMonthlyIncomeCents,
        sustainableMonthlyIncomeRealCents: scenario.outcome.realSustainableMonthlyIncomeCents,
        targetFundNominalCents: result.target.nominalFundAtRetirementCents,
        targetFundRealCents: result.target.realFundCents,
        targetGapOrSurplusNominalCents: scenario.outcome.nominalTargetSurplusCents - scenario.outcome.nominalTargetGapCents,
        targetGapOrSurplusRealCents: scenario.outcome.realTargetSurplusCents - scenario.outcome.realTargetGapCents,
      };
    }),
  };
}

function buildRetirementStatus(params: {
  data: CioSnapshotData;
  asOfDate: Date;
  retirementAssetsCents: number;
  derivedAnnualContributionCents: number;
  overrides?: CioRetirementProjectionInput;
}): CioRetirementStatus {
  const profile = params.data.householdProfile;
  const override = params.overrides ?? {};
  const missing: string[] = [];
  const value = <T>(overrideValue: T | undefined, profileValue: T | null | undefined, field: string): T | null => {
    const resolved = overrideValue === undefined ? profileValue ?? null : overrideValue;
    if (resolved === null) missing.push(field);
    return resolved;
  };
  const inflationBps = value(override.inflationRateBps, profile?.inflationRateBps, "inflationRateBps");
  const bearReturnBps = value(override.bearReturnBps, profile?.bearReturnBps, "bearReturnBps");
  const baseReturnBps = value(override.baseReturnBps, profile?.baseReturnBps, "baseReturnBps");
  const bullReturnBps = value(override.bullReturnBps, profile?.bullReturnBps, "bullReturnBps");
  const spending = value(override.targetMonthlySpendingTodayCents, profile?.targetMonthlyRetirementSpendingCents, "targetMonthlyRetirementSpendingCents");
  const withdrawalRate = value(override.sustainableWithdrawalRateBps, profile?.sustainableWithdrawalRateBps, "sustainableWithdrawalRateBps");
  const targetDateValue = override.targetRetirementDate !== undefined
    ? override.targetRetirementDate
    : override.targetRetirementAge !== undefined
      ? undefined
      : profile?.targetRetirementDate?.toISOString();
  const targetAge = override.targetRetirementAge !== undefined
    ? override.targetRetirementAge
    : override.targetRetirementDate !== undefined
      ? null
      : profile?.targetRetirementAge ?? null;
  let currentAge: number | null = null;
  if (profile?.primaryBirthDate) currentAge = ageAtDate(profile.primaryBirthDate, params.asOfDate);
  else if (profile?.primaryCurrentAge !== null && profile?.primaryCurrentAge !== undefined && profile.primaryAgeAsOfDate) {
    currentAge = profile.primaryCurrentAge + ageAtDate(profile.primaryAgeAsOfDate, params.asOfDate);
  }
  if (!targetDateValue && targetAge === null) missing.push("targetRetirementDateOrAge");
  if (!targetDateValue && targetAge !== null && !profile?.primaryBirthDate && currentAge === null) missing.push("primaryBirthDateOrCurrentAge");
  if (missing.length) return { status: "NOT_READY", missingFields: [...new Set(missing)], projection: null };

  const annualContribution = override.annualExternalContributionCents
    ?? profile?.annualExternalContributionOverrideCents
    ?? params.derivedAnnualContributionCents;
  try {
    const result = projectRetirement({
      asOfDate: params.asOfDate,
      currentRetirementAssetsCents: override.currentRetirementAssetsCents ?? params.retirementAssetsCents,
      annualExternalContributionCents: annualContribution,
      contributionGrowthBps: override.contributionGrowthRateBps ?? profile?.contributionGrowthRateBps ?? 0,
      inflationBps: inflationBps!,
      bearReturnBps: bearReturnBps!,
      baseReturnBps: baseReturnBps!,
      bullReturnBps: bullReturnBps!,
      targetMonthlyRetirementSpendingCents: spending!,
      sustainableWithdrawalRateBps: withdrawalRate!,
      targetRetirementDate: targetDateValue ?? null,
      primaryBirthDate: profile?.primaryBirthDate ?? null,
      currentAge,
      targetRetirementAge: targetAge,
    });
    return { status: "READY", missingFields: [], projection: convertProjection(result, profile, currentAge) };
  } catch (error) {
    if (error instanceof RetirementProjectionValidationError) {
      return {
        status: "NOT_READY",
        missingFields: [`invalid_${error.field ?? error.code}`],
        projection: null,
      };
    }
    throw error;
  }
}

export async function buildCioSnapshot(params: {
  workspaceId: string;
  asOfDate?: string | Date;
  retirementOverrides?: CioRetirementProjectionInput;
  db?: CioDb;
}): Promise<CioSnapshot> {
  const asOfDate = normalizeAsOfDate(params.asOfDate ?? params.retirementOverrides?.asOfDate);
  const overrides = params.retirementOverrides
    ? CioRetirementProjectionInputSchema.parse(params.retirementOverrides)
    : undefined;
  const data = await loadCioSnapshotData({ workspaceId: params.workspaceId, asOfDate }, params.db);
  const staleAfterDays = data.investmentPolicy?.confirmedAt
    ? data.investmentPolicy.valuationStaleAfterDays
    : 90;

  const bankControlCents = safeSum(data.bankControls.map((account) => account.startingCents), "bank control total");
  const savingsSubAccountCents = safeSum(
    data.savingsSubAccounts.map((account) => account.availableCents),
    "savings sub-account total",
  );
  const valuedInvestments = data.investments.filter((investment) => investment.entries[0]);
  const investmentCurrentValueCents = safeSum(
    valuedInvestments.map((investment) => investment.entries[0]!.currentValueCents),
    "investment total",
  );
  const planningAssets = data.planningPositions.filter((position) => position.side === "ASSET");
  const planningLiabilities = data.planningPositions.filter((position) => position.side === "LIABILITY");
  const planningPositionAssetsCents = safeSum(planningAssets.map((position) => position.currentValueCents), "planning assets");
  const planningLiabilitiesCents = safeSum(planningLiabilities.map((position) => position.currentValueCents), "planning liabilities");
  const financialAssetsCents = safeSum([savingsSubAccountCents, investmentCurrentValueCents], "financial assets");

  const allocationSources: AllocationSource[] = [
    ...data.savingsSubAccounts.filter((account) => account.availableCents >= 0).map((account) => ({
      id: `savings-sub-account:${account.id}`,
      valueCents: account.availableCents,
      assetClassExposures: [{ key: "CASH", weightBps: 10_000 }],
    })),
    ...valuedInvestments.filter((investment) => investment.entries[0]!.currentValueCents >= 0).map((investment) => ({
      id: `investment:${investment.id}`,
      valueCents: investment.entries[0]!.currentValueCents,
      assetClassExposures: investment.cioProfile?.classificationStatus === "USER_CONFIRMED"
        ? exposureSlices(investment.cioExposures, "ASSET_CLASS")
        : undefined,
      geographyExposures: investment.cioProfile?.classificationStatus === "USER_CONFIRMED"
        ? exposureSlices(investment.cioExposures, "GEOGRAPHY")
        : undefined,
      securityExposures: investment.cioProfile?.classificationStatus === "USER_CONFIRMED"
        ? exposureSlices(investment.cioExposures, "SECURITY")
        : undefined,
    })),
    ...planningAssets.filter((position) => position.includeInInvestableAllocation).map((position) => ({
      id: `position:${position.id}`,
      valueCents: position.currentValueCents,
      assetClassExposures: (CIO_ASSET_CLASSES as readonly string[]).includes(position.category)
        ? [{ key: position.category, weightBps: 10_000 }]
        : undefined,
    })),
  ];
  const allocation = toAllocationSummary(allocationSources);

  const investmentSnapshots = data.investments.map((investment) => {
    const entry = investment.entries[0] ?? null;
    const confirmedProfile = investment.cioProfile?.classificationStatus === "USER_CONFIRMED"
      ? investment.cioProfile
      : null;
    const liquidityClass = (confirmedProfile?.liquidityClass
      ?? (investment.isLiquid ? "LIQUID" : "LOCKED")) as CioLiquidityClass;
    return {
      id: investment.id,
      latestValuationDate: entry ? isoDate(entry.date) : null,
      investedCents: entry?.investedCents ?? null,
      currentValueCents: entry?.currentValueCents ?? null,
      valuationAgeDays: entry ? differenceInUtcDays(asOfDate, entry.date) : null,
      isStale: entry ? differenceInUtcDays(asOfDate, entry.date) > staleAfterDays : false,
      liquidityClass,
      liquiditySource: confirmedProfile ? "CIO_PROFILE" as const : "LEGACY_IS_LIQUID_FALLBACK" as const,
      portfolioRole: (confirmedProfile?.portfolioRole ?? null) as CioSnapshot["investments"][number]["portfolioRole"],
      includeInRetirementProjection: confirmedProfile?.includeInRetirementProjection ?? false,
      classificationStatus: (investment.cioProfile?.classificationStatus ?? "UNCLASSIFIED") as CioSnapshot["investments"][number]["classificationStatus"],
    };
  });
  const liquidityRaw = calculateLiquidityTotals([
    ...data.bankControls.filter((account) => account.startingCents >= 0).map((account) => ({ id: `bank:${account.id}`, valueCents: account.startingCents, liquidityClass: "IMMEDIATE" as const })),
    ...investmentSnapshots.filter((investment) => investment.currentValueCents !== null && investment.currentValueCents >= 0).map((investment) => ({ id: `investment:${investment.id}`, valueCents: investment.currentValueCents!, liquidityClass: investment.liquidityClass })),
    ...planningAssets.map((position) => ({ id: `position:${position.id}`, valueCents: position.currentValueCents, liquidityClass: position.liquidityClass as CioLiquidityClass })),
  ]);
  const runway = calculateEmergencyRunway(liquidityRaw.accessibleValueCents, data.householdProfile?.essentialMonthlySpendingCents);
  const liquidity = {
    immediateCents: liquidityRaw.immediateValueCents,
    liquidCents: liquidityRaw.liquidValueCents,
    restrictedCents: liquidityRaw.restrictedValueCents,
    lockedCents: liquidityRaw.lockedValueCents + liquidityRaw.unknownValueCents,
    readilyAvailableCents: liquidityRaw.accessibleValueCents,
    essentialMonthlyExpenseCents: runway.essentialMonthlyExpenseCents,
    emergencyRunwayMonths: runway.runwayMonthsBps === null ? null : runway.runwayMonthsBps / 10_000,
  };

  const flowResult = summarizeRecurringFlows(data.recurringFlows.map((flow) => ({
    id: flow.id,
    type: flow.type as "EXTERNAL_CONTRIBUTION" | "INTERNAL_REALLOCATION" | "EXTERNAL_WITHDRAWAL",
    amountCents: flow.amountCents,
    cadence: flow.cadence as "WEEKLY" | "MONTHLY" | "QUARTERLY" | "ANNUAL",
    startDate: flow.startsOn,
    endDate: flow.endsOn,
    includeInRetirementProjection: flow.includeInRetirementProjection,
    label: flow.label,
    sourceAccountId: flow.sourceFinancialAccountId,
    sourceInvestmentId: flow.sourceInvestmentAccountId,
    destinationInvestmentId: flow.destinationInvestmentAccountId,
  })), asOfDate);
  const recurringFlows = {
    externalContributionAnnualCents: flowResult.active.externalContributionCents,
    externalWithdrawalAnnualCents: flowResult.active.externalWithdrawalCents,
    netExternalContributionAnnualCents: flowResult.active.netExternalContributionCents,
    internalReallocationAnnualCents: flowResult.active.internalReallocationCents,
    retirementEligibleNetExternalAnnualCents: flowResult.retirementEligible.netExternalContributionCents,
    breakdown: flowResult.sourceBreakdown.filter((flow) => flow.active).map((flow) => ({
      id: flow.id,
      label: flow.label ?? "Recurring flow",
      type: flow.type,
      cadence: flow.cadence,
      amountCents: data.recurringFlows.find((item) => item.id === flow.id)?.amountCents ?? 0,
      annualizedCents: flow.annualizedCents,
      includeInRetirementProjection: flow.retirementEligible,
    })),
  };

  const retirementIncludedAssetsCents = safeSum([
    ...valuedInvestments
      .filter((investment) =>
        investment.cioProfile?.classificationStatus === "USER_CONFIRMED"
        && investment.cioProfile.includeInRetirementProjection
        && investment.entries[0]!.currentValueCents >= 0)
      .map((investment) => investment.entries[0]!.currentValueCents),
    ...planningAssets.filter((position) => position.includeInRetirementProjection).map((position) => position.currentValueCents),
  ], "retirement assets");
  const overrideContribution = data.householdProfile?.annualExternalContributionOverrideCents ?? null;
  const configuredAnnualContributionCents = overrideContribution
    ?? recurringFlows.retirementEligibleNetExternalAnnualCents;
  const contributionGrowthRateBps = data.householdProfile?.contributionGrowthRateBps ?? null;
  const currentYearContributionCents = calculateAnnualInvestmentContributions(data.investments)
    .find((contribution) => contribution.year === asOfDate.getUTCFullYear())
    ?.contributedCents ?? 0;
  const contributionProgress = contributionGrowthRateBps !== null && configuredAnnualContributionCents > 0
    ? calculateCioContributionProgress({
      asOfDate,
      actualYtdCents: currentYearContributionCents,
      annualTargetCents: configuredAnnualContributionCents,
      contributionGrowthRateBps,
      targetSource: overrideContribution !== null ? "OVERRIDE" : "DERIVED",
    })
    : null;
  const retirement = buildRetirementStatus({
    data,
    asOfDate,
    retirementAssetsCents: retirementIncludedAssetsCents,
    derivedAnnualContributionCents: recurringFlows.retirementEligibleNetExternalAnnualCents,
    overrides,
  });

  const knownInvestmentLabels = new Set(data.investments.flatMap((investment) => [
    normalizeDuplicateLabel(investment.displayName),
    normalizeDuplicateLabel(investment.productName),
    normalizeDuplicateLabel(investment.institutionName),
  ]).filter(Boolean));
  const duplicatePositionIds = planningAssets
    .filter((position) => knownInvestmentLabels.has(normalizeDuplicateLabel(position.label)))
    .map((position) => position.id);
  const truncatedSections = Object.entries(data.truncated).filter(([, truncated]) => truncated).map(([section]) => section);
  const missingHouseholdFields = missingHouseholdAssumptions(data.householdProfile);
  const dataQuality = assessCioDataQuality({
    asOfDate,
    investments: data.investments.map((investment) => {
      const assetClassExposures = exposureSlices(investment.cioExposures, "ASSET_CLASS");
      const geographyExposures = exposureSlices(investment.cioExposures, "GEOGRAPHY");
      const hasConfirmedProfile = investment.cioProfile?.classificationStatus === "USER_CONFIRMED";
      return {
        id: investment.id,
        latestValuationDate: investment.entries[0]?.date ?? null,
        currentValueCents: investment.entries[0]?.currentValueCents ?? null,
        hasConfirmedProfile,
        hasAssetClassExposure: hasConfirmedProfile && Boolean(assetClassExposures?.every((exposure) => exposure.key !== "UNKNOWN")),
        hasGeographyExposure: hasConfirmedProfile && Boolean(geographyExposures?.every((exposure) => exposure.key !== "UNKNOWN")),
      };
    }),
    hasHouseholdProfile: missingHouseholdFields.length === 0,
    missingHouseholdFields,
    hasConfirmedPolicy: Boolean(data.investmentPolicy?.confirmedAt),
    staleAfterDays,
    bankControlCount: data.bankControlCount,
    bankControlsAfterAsOfCount: data.bankControlsAfterAsOfCount,
    savingsSubAccountCount: data.savingsSubAccountCount,
    savingsSubAccountsAfterAsOfCount: data.savingsSubAccountsAfterAsOfCount,
    duplicatePlanningPositionIds: duplicatePositionIds,
    truncatedSections,
  });

  const latestBankControlDate = data.bankControls.reduce<Date | null>(
    (latest, account) => latest === null || account.updatedAt > latest ? account.updatedAt : latest,
    null,
  );
  const latestSavingsSubAccountDate = data.savingsSubAccounts.reduce<Date | null>(
    (latest, account) => latest === null || account.updatedAt > latest ? account.updatedAt : latest,
    null,
  );
  const evidence: CioEvidenceRef[] = [
    { id: "workspace-financial-assets", kind: "WORKSPACE", label: "Workspace financial assets", href: "/cio", asOfDate: isoDate(asOfDate) },
    { id: "bank-controls", kind: "BANK_CONTROL", label: `${data.bankControls.length} eligible bank control balance${data.bankControls.length === 1 ? "" : "s"}`, href: "/", asOfDate: latestBankControlDate ? isoDate(latestBankControlDate) : isoDate(asOfDate) },
    { id: "savings-sub-accounts", kind: "SAVINGS_SUB_ACCOUNT", label: `${data.savingsSubAccounts.length} planning-eligible savings sub-account${data.savingsSubAccounts.length === 1 ? "" : "s"}`, href: "/transactions", asOfDate: latestSavingsSubAccountDate ? isoDate(latestSavingsSubAccountDate) : isoDate(asOfDate) },
    ...(data.householdProfile ? [{
      id: "cio-household-profile",
      kind: "CIO_PROFILE" as const,
      label: "CIO household assumptions",
      href: "/cio?setup=profile",
      asOfDate: isoDate(data.householdProfile.updatedAt),
    }] : []),
    ...(data.investmentPolicy ? [{
      id: "cio-investment-policy",
      kind: "CIO_POLICY" as const,
      label: data.investmentPolicy.confirmedAt ? "Confirmed CIO investment policy" : "Draft CIO investment policy",
      href: "/cio?setup=policy",
      asOfDate: isoDate(data.investmentPolicy.updatedAt),
    }] : []),
    ...investmentSnapshots.slice(0, 20).map((investment) => ({
      id: `investment-${investment.id}`,
      kind: "INVESTMENT_VALUATION" as const,
      label: investment.latestValuationDate ? "Recorded investment valuation" : "Investment missing valuation",
      href: `/investments?accountId=${encodeURIComponent(investment.id)}`,
      asOfDate: investment.latestValuationDate ?? isoDate(asOfDate),
    })),
    ...data.planningPositions.slice(0, 10).map((position) => ({
      id: `planning-position-${position.id}`,
      kind: "PLANNING_POSITION" as const,
      label: `${position.side === "ASSET" ? "Asset" : "Liability"} planning position`,
      href: `/cio?setup=positions&id=${encodeURIComponent(position.id)}`,
      asOfDate: isoDate(position.asOfDate),
    })),
    ...data.recurringFlows.slice(0, 10).map((flow) => ({
      id: `recurring-flow-${flow.id}`,
      kind: "RECURRING_FLOW" as const,
      label: "Configured recurring planning flow",
      href: "/cio?setup=flows",
      asOfDate: isoDate(flow.updatedAt),
    })),
  ];
  const policyExceptions = evaluateCioPolicy({
    minimumImmediateBankCashCents: data.householdProfile?.minimumImmediateBankCashCents,
    immediateBankCashCents: bankControlCents,
    policy: data.investmentPolicy?.confirmedAt ? {
      minimumLiquidityReserveCents: data.investmentPolicy.minimumLiquidityReserveCents,
      minimumLiquidityMonths: data.investmentPolicy.minimumLiquidityMonths,
      maximumAccountConcentrationBps: data.investmentPolicy.maximumAccountConcentrationBps,
      maximumSingleSecurityConcentrationBps: data.investmentPolicy.maximumSingleSecurityConcentrationBps,
      maximumSatelliteAllocationBps: data.investmentPolicy.maximumSatelliteAllocationBps,
      assetClassBands: data.investmentPolicy.assetClassBands,
      geographyLimits: data.investmentPolicy.geographyLimits,
    } : null,
    allocation,
    liquidity,
    dataQuality,
    accounts: investmentSnapshots.filter((investment) => investment.currentValueCents !== null && investment.currentValueCents >= 0).map((investment) => ({
      id: investment.id,
      currentValueCents: investment.currentValueCents!,
      portfolioRole: investment.portfolioRole,
    })),
    retirementProjection: retirement.status === "READY" ? retirement.projection : null,
    evidence,
  });

  return {
    asOfDate: isoDate(asOfDate),
    baseCurrency: data.workspace.baseCurrency || "SGD",
    totals: {
      bankControlCents,
      savingsSubAccountCents,
      investmentCurrentValueCents,
      financialAssetsCents,
      planningPositionAssetsCents,
      planningLiabilitiesCents,
      planningNetWorthCents: safeSum([financialAssetsCents, planningPositionAssetsCents, -planningLiabilitiesCents], "planning net worth"),
      investableAssetsCents: allocation.totalCents,
      retirementIncludedAssetsCents,
    },
    liquidity,
    allocation,
    investments: investmentSnapshots,
    recurringFlows,
    annualContributions: {
      derivedExternalAnnualCents: recurringFlows.retirementEligibleNetExternalAnnualCents,
      overrideExternalAnnualCents: overrideContribution,
      usedExternalAnnualCents: overrides?.annualExternalContributionCents ?? overrideContribution ?? recurringFlows.retirementEligibleNetExternalAnnualCents,
      source: overrides?.annualExternalContributionCents !== undefined || overrideContribution !== null ? "OVERRIDE" : "DERIVED",
      internalReallocationAnnualCents: recurringFlows.internalReallocationAnnualCents,
    },
    contributionProgress,
    dataQuality,
    policyExceptions,
    retirement,
    evidence,
  };
}

export async function runWorkspaceRetirementProjection(params: {
  workspaceId: string;
  input: CioRetirementProjectionInput;
  db?: CioDb;
}) {
  const input = CioRetirementProjectionInputSchema.parse(params.input);
  const snapshot = await buildCioSnapshot({
    workspaceId: params.workspaceId,
    asOfDate: input.asOfDate,
    retirementOverrides: input,
    db: params.db,
  });
  return {
    asOfDate: snapshot.asOfDate,
    baseCurrency: snapshot.baseCurrency,
    retirement: snapshot.retirement,
    dataQuality: snapshot.dataQuality,
    evidence: snapshot.evidence,
  };
}
