import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";
import type { AskNestEvidence } from "@/lib/ai/ask-nest-types";
import { ApiRequestError } from "@/lib/api/contracts";
import {
  buildCioSnapshot,
  buildWorkspaceCioAdvisorBrief,
  buildWorkspaceCioStrategyRecommendations,
  CIO_MAX_CENTS,
  getCioPolicy,
  planWorkspaceCioNewMoney,
  runWorkspaceRetirementProjection,
  type CioDataQualitySummary,
  type CioEvidenceRef,
  type CioPolicyException,
  type CioRetirementProjectionPoint,
  type CioRetirementStatus,
  type CioSnapshot,
  type CioStrategyRecommendation,
  monthlyEquivalentCents,
} from "@/lib/domains/cio";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DateOnlySchema = z.string().regex(ISO_DATE_PATTERN).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Expected a valid calendar date");
const NullableDateSchema = DateOnlySchema.nullable();

const CioAsOfArgsSchema = z.object({
  as_of_date: NullableDateSchema,
}).strict();

const CioRetirementArgsSchema = z.object({
  as_of_date: NullableDateSchema,
  annual_external_contribution_cents: z.number().int().min(-CIO_MAX_CENTS).max(CIO_MAX_CENTS).nullable(),
  target_retirement_age: z.number().int().min(18).max(120).nullable(),
  target_retirement_date: NullableDateSchema,
}).strict().superRefine((value, ctx) => {
  if (value.target_retirement_age !== null && value.target_retirement_date !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["target_retirement_date"],
      message: "Use either target retirement age or target retirement date, not both.",
    });
  }
});

const CioContributionComparisonArgsSchema = z.object({
  as_of_date: NullableDateSchema,
  additional_annual_contribution_cents: z.number().int().min(0).max(CIO_MAX_CENTS),
}).strict();

const CioNewMoneyArgsSchema = z.object({
  as_of_date: NullableDateSchema,
  amount_cents: z.number().int().min(1).max(CIO_MAX_CENTS),
}).strict();

type CioToolContext = {
  workspaceId: string;
  userId: string;
  currency: string;
  callId: string;
};

type CioToolResult = {
  output: Record<string, unknown>;
  evidence: AskNestEvidence[];
};

const nullableDateParameter = {
  type: ["string", "null"],
  pattern: String.raw`^\d{4}-\d{2}-\d{2}$`,
} as const;

const nullableIntegerParameter = { type: ["integer", "null"] } as const;

export const CIO_ASK_NEST_TOOL_NAMES = [
  "get_cio_overview",
  "get_cio_policy_status",
  "get_cio_strategy_recommendations",
  "run_cio_retirement_projection",
  "compare_cio_contribution_scenarios",
  "get_cio_advisor_brief",
  "plan_cio_new_money",
] as const;

const CIO_ASK_NEST_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "get_cio_overview",
    description: "Get the deterministic Nest CIO overview for the authorized workspace, including asset totals, allocation, liquidity, recurring flows, retirement readiness, data completeness, and policy exceptions. This is read-only and never executes a trade or transfer.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD data date, otherwise null for today." },
      },
      required: ["as_of_date"],
    },
  },
  {
    type: "function",
    name: "get_cio_policy_status",
    description: "Get the authorized workspace's configured investment-policy limits and deterministic exceptions. Use this for policy, emergency-reserve, concentration, stale-data, or rebalancing-review questions. This tool only provides decision support and never places orders.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD data date, otherwise null for today." },
      },
      required: ["as_of_date"],
    },
  },
  {
    type: "function",
    name: "get_cio_strategy_recommendations",
    description: "Get read-only deterministic personalized household strategy recommendations for liquidity, allocation, contribution direction, concentration, and retirement. Recommendations use confirmed policy and execute no trade, transfer, purchase, or sale. This tool never recommends an individual security.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD data date, otherwise null for today." },
      },
      required: ["as_of_date"],
    },
  },
  {
    type: "function",
    name: "run_cio_retirement_projection",
    description: "Run Nest's deterministic bear/base/bull retirement projection for the authorized workspace. Nullable overrides are temporary read-only scenario assumptions and are not saved.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD projection date, otherwise null for today." },
        annual_external_contribution_cents: { ...nullableIntegerParameter, minimum: -CIO_MAX_CENTS, maximum: CIO_MAX_CENTS, description: "Optional temporary annual net external contribution in integer cents, or null to use the configured/derived value. Internal reallocations are excluded." },
        target_retirement_age: { ...nullableIntegerParameter, minimum: 18, maximum: 120, description: "Optional temporary target retirement age, or null. Do not set with target_retirement_date." },
        target_retirement_date: { ...nullableDateParameter, description: "Optional temporary YYYY-MM-DD target retirement date, or null. Do not set with target_retirement_age." },
      },
      required: ["as_of_date", "annual_external_contribution_cents", "target_retirement_age", "target_retirement_date"],
    },
  },
  {
    type: "function",
    name: "compare_cio_contribution_scenarios",
    description: "Compare the configured/derived retirement projection with a scenario that adds a specified annual external contribution. The increment must be integer cents; internal reallocations are never counted as contributions. Nothing is saved or executed.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD projection date, otherwise null for today." },
        additional_annual_contribution_cents: { type: "integer", minimum: 0, maximum: CIO_MAX_CENTS, description: "Additional annual external contribution in integer cents above the configured/derived baseline." },
      },
      required: ["as_of_date", "additional_annual_contribution_cents"],
    },
  },
  {
    type: "function",
    name: "get_cio_advisor_brief",
    description: "Get Nest's read-only deterministic CIO advisory brief: strategy status and stance, prioritized recommendations, asset-class drift against confirmed bands with currency differences, new money needed to reach every band minimum, liquidity floor shortfall and months to restore it, contribution pace with monthly equivalents, and retirement levers (required annual and monthly contribution, additional contribution, earliest funded retirement date, required base return). Use it for broad advice, strategy, what-should-I-do, trade-off, and how-far-off questions. It never executes a trade or recommends an individual security.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD data date, otherwise null for today." },
      },
      required: ["as_of_date"],
    },
  },
  {
    type: "function",
    name: "plan_cio_new_money",
    description: "Split a hypothetical amount of new investable money across the household's confirmed asset-class bands, filling target shortfalls first and then target weights, and show each band before and after. Use it when the user asks where new money, a bonus, or savings should go. It is read-only, is not saved, never sells, and never names an individual security or product.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        as_of_date: { ...nullableDateParameter, description: "Optional YYYY-MM-DD data date, otherwise null for today." },
        amount_cents: { type: "integer", minimum: 1, maximum: CIO_MAX_CENTS, description: "Hypothetical new external money in integer cents, as stated by the user." },
      },
      required: ["as_of_date", "amount_cents"],
    },
  },
];

export function getCioAskNestTools() {
  return CIO_ASK_NEST_TOOLS;
}

function formatMoney(valueCents: number, currency: string) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valueCents / 100).replace(/\u00a0/g, " ");
}

function money(valueCents: number | null, currency: string) {
  return valueCents === null ? null : {
    cents: valueCents,
    formatted: formatMoney(valueCents, currency),
  };
}

function percentage(valueBps: number | null) {
  return valueBps === null ? null : {
    basisPoints: valueBps,
    formatted: `${(valueBps / 100).toFixed(2)}%`,
  };
}

function safeHref(href: string) {
  const path = href.split("?", 1)[0];
  return path.startsWith("/") && !path.startsWith("//") ? path : "/cio";
}

function toEvidence(refs: readonly CioEvidenceRef[], callId: string) {
  const unique = [...new Map(refs.map((ref) => [`${ref.kind}:${ref.label}:${safeHref(ref.href)}`, ref])).values()];
  return unique.slice(0, 8).map((ref, index): AskNestEvidence => ({
    id: `${callId.slice(0, 120)}:cio-evidence-${index + 1}`,
    label: ref.label,
    detail: `${ref.kind.replaceAll("_", " ")} data as of ${ref.asOfDate}.`,
    href: safeHref(ref.href),
  }));
}

function dataQuality(summary: CioDataQualitySummary) {
  const warnings = summary.warnings.slice(0, 20).map((warning) => ({
    code: warning.code,
    severity: warning.severity,
    message: warning.message,
    href: safeHref(warning.setupHref),
  }));
  return {
    completeness: percentage(summary.completenessBps),
    latestValuationDate: summary.latestValuationDate,
    oldestValuationDate: summary.oldestValuationDate,
    warningCount: summary.warnings.length,
    returnedWarningCount: warnings.length,
    warningsTruncated: warnings.length < summary.warnings.length,
    warnings,
  };
}

function policyMetric(
  metric: { unit: "CENTS" | "BPS" | "MONTHS" | "DAYS" | "COUNT"; value: number | null } | null,
  currency: string,
) {
  if (!metric) return null;
  if (metric.unit === "CENTS") return { unit: metric.unit, amount: money(metric.value, currency) };
  if (metric.unit === "BPS") return { unit: metric.unit, percentage: percentage(metric.value) };
  return { unit: metric.unit, value: metric.value };
}

function policyExceptions(exceptions: readonly CioPolicyException[], currency: string) {
  return exceptions.slice(0, 20).map((exception) => ({
    code: exception.code,
    severity: exception.severity,
    title: exception.title,
    actual: policyMetric(exception.actual, currency),
    threshold: policyMetric(exception.threshold, currency),
    reviewAction: exception.reviewAction,
  }));
}

function allocations(snapshot: CioSnapshot) {
  const mapBucket = (bucket: CioSnapshot["allocation"]["assetClasses"][number]) => ({
    key: bucket.key,
    value: money(bucket.valueCents, snapshot.baseCurrency),
    allocation: percentage(bucket.allocationBps),
    sourceCount: bucket.sourceCount,
    isUnknown: bucket.isUnknown,
  });
  const returnedSecurities = snapshot.allocation.securities.slice(0, 20);
  const unknownSecurity = snapshot.allocation.securities.find((bucket) => bucket.key === "UNKNOWN");
  if (unknownSecurity && !returnedSecurities.some((bucket) => bucket.key === "UNKNOWN")) {
    returnedSecurities[returnedSecurities.length - 1] = unknownSecurity;
  }
  const returnedSecurityKeys = new Set(returnedSecurities.map((bucket) => bucket.key));
  const toolOmittedSecurities = snapshot.allocation.securities.filter((bucket) => !returnedSecurityKeys.has(bucket.key));
  const omittedSecurityValueCents = snapshot.allocation.omittedSecurityValueCents
    + toolOmittedSecurities.reduce((sum, bucket) => sum + bucket.valueCents, 0);
  const omittedSecurityAllocationBps = snapshot.allocation.omittedSecurityAllocationBps
    + toolOmittedSecurities.reduce((sum, bucket) => sum + bucket.allocationBps, 0);
  const unknownAssetClass = snapshot.allocation.assetClasses.find((bucket) => bucket.key === "UNKNOWN");
  const unknownGeography = snapshot.allocation.geographies.find((bucket) => bucket.key === "UNKNOWN");
  return {
    total: money(snapshot.allocation.totalCents, snapshot.baseCurrency),
    assetClasses: snapshot.allocation.assetClasses.map(mapBucket),
    geographies: snapshot.allocation.geographies.map(mapBucket),
    securities: returnedSecurities.map(mapBucket),
    securityBucketCount: snapshot.allocation.securityBucketCount,
    returnedSecurityBucketCount: returnedSecurities.length,
    securitiesTruncated: returnedSecurities.length < snapshot.allocation.securityBucketCount,
    omittedSecurityValue: money(omittedSecurityValueCents, snapshot.baseCurrency),
    omittedSecurityAllocation: percentage(omittedSecurityAllocationBps),
    unknownAssetClass: unknownAssetClass ? mapBucket(unknownAssetClass) : null,
    unknownGeography: unknownGeography ? mapBucket(unknownGeography) : null,
    unknownSecurity: unknownSecurity ? mapBucket(unknownSecurity) : null,
  };
}

function sampleProjectionPoints(
  points: readonly CioRetirementProjectionPoint[],
  currency: string,
) {
  const indexes = new Set<number>();
  if (points.length <= 12) {
    points.forEach((_, index) => indexes.add(index));
  } else {
    indexes.add(0);
    indexes.add(points.length - 1);
    for (let index = 1; index < 11; index += 1) {
      indexes.add(Math.round((index * (points.length - 1)) / 11));
    }
  }
  return [...indexes].sort((left, right) => left - right).map((index) => {
    const point = points[index];
    return {
      date: point.date,
      year: point.year,
      age: point.age,
      nominal: money(point.nominalCents, currency),
      real: money(point.realCents, currency),
      annualContribution: money(point.annualContributionCents, currency),
    };
  });
}

function retirement(status: CioRetirementStatus, currency: string) {
  if (status.status === "NOT_READY") {
    return { status: status.status, missingFields: status.missingFields, assumptions: null, scenarios: [] };
  }
  return {
    status: status.status,
    missingFields: status.missingFields,
    assumptions: {
      asOfDate: status.projection.assumptions.asOfDate,
      retirementDate: status.projection.assumptions.retirementDate,
      horizonYears: status.projection.assumptions.horizonYears,
      currentRetirementAssets: money(status.projection.assumptions.currentRetirementAssetsCents, currency),
      annualExternalContribution: money(status.projection.assumptions.annualExternalContributionCents, currency),
      contributionGrowth: percentage(status.projection.assumptions.contributionGrowthRateBps),
      inflation: percentage(status.projection.assumptions.inflationRateBps),
      bearReturn: percentage(status.projection.assumptions.bearReturnBps),
      baseReturn: percentage(status.projection.assumptions.baseReturnBps),
      bullReturn: percentage(status.projection.assumptions.bullReturnBps),
      targetMonthlySpendingToday: money(status.projection.assumptions.targetMonthlySpendingTodayCents, currency),
      sustainableWithdrawalRate: percentage(status.projection.assumptions.sustainableWithdrawalRateBps),
      contributionTiming: status.projection.assumptions.contributionTiming,
      finalPeriodFraction: percentage(status.projection.assumptions.finalPeriodFractionBps),
      horizonRounding: status.projection.assumptions.horizonRounding,
    },
    scenarios: status.projection.scenarios.map((scenario) => ({
      scenario: scenario.scenario,
      nominalReturn: percentage(scenario.nominalReturnBps),
      fundAtRetirementNominal: money(scenario.fundAtRetirementNominalCents, currency),
      fundAtRetirementReal: money(scenario.fundAtRetirementRealCents, currency),
      sustainableMonthlyIncomeNominal: money(scenario.sustainableMonthlyIncomeNominalCents, currency),
      sustainableMonthlyIncomeReal: money(scenario.sustainableMonthlyIncomeRealCents, currency),
      targetFundNominal: money(scenario.targetFundNominalCents, currency),
      targetFundReal: money(scenario.targetFundRealCents, currency),
      targetGapOrSurplusNominal: money(scenario.targetGapOrSurplusNominalCents, currency),
      targetGapOrSurplusReal: money(scenario.targetGapOrSurplusRealCents, currency),
      sampledPoints: sampleProjectionPoints(scenario.points, currency),
      totalPointCount: scenario.points.length,
      pointsSampled: scenario.points.length > 12,
    })),
  };
}

function overviewOutput(snapshot: CioSnapshot) {
  const exceptions = policyExceptions(snapshot.policyExceptions, snapshot.baseCurrency);
  return {
    ok: true,
    readOnly: true,
    asOfDate: snapshot.asOfDate,
    currency: snapshot.baseCurrency,
    facts: {
      financialAssets: money(snapshot.totals.financialAssetsCents, snapshot.baseCurrency),
      bankControlBalance: money(snapshot.totals.bankControlCents, snapshot.baseCurrency),
      planningEligibleSavingsSubAccounts: money(snapshot.totals.savingsSubAccountCents, snapshot.baseCurrency),
      investmentValue: money(snapshot.totals.investmentCurrentValueCents, snapshot.baseCurrency),
      planningAssets: money(snapshot.totals.planningPositionAssetsCents, snapshot.baseCurrency),
      planningLiabilities: money(snapshot.totals.planningLiabilitiesCents, snapshot.baseCurrency),
      planningNetWorth: money(snapshot.totals.planningNetWorthCents, snapshot.baseCurrency),
      investableAssets: money(snapshot.totals.investableAssetsCents, snapshot.baseCurrency),
      retirementIncludedAssets: money(snapshot.totals.retirementIncludedAssetsCents, snapshot.baseCurrency),
    },
    calculations: {
      allocation: allocations(snapshot),
      liquidity: {
        immediate: money(snapshot.liquidity.immediateCents, snapshot.baseCurrency),
        liquid: money(snapshot.liquidity.liquidCents, snapshot.baseCurrency),
        restricted: money(snapshot.liquidity.restrictedCents, snapshot.baseCurrency),
        locked: money(snapshot.liquidity.lockedCents, snapshot.baseCurrency),
        readilyAvailable: money(snapshot.liquidity.readilyAvailableCents, snapshot.baseCurrency),
        essentialMonthlyExpense: money(snapshot.liquidity.essentialMonthlyExpenseCents, snapshot.baseCurrency),
        emergencyRunwayMonths: snapshot.liquidity.emergencyRunwayMonths,
      },
      recurringFlows: {
        externalContributionsAnnual: money(snapshot.recurringFlows.externalContributionAnnualCents, snapshot.baseCurrency),
        externalWithdrawalsAnnual: money(snapshot.recurringFlows.externalWithdrawalAnnualCents, snapshot.baseCurrency),
        netExternalContributionsAnnual: money(snapshot.recurringFlows.netExternalContributionAnnualCents, snapshot.baseCurrency),
        internalReallocationsAnnual: money(snapshot.recurringFlows.internalReallocationAnnualCents, snapshot.baseCurrency),
        retirementEligibleNetExternalAnnual: money(snapshot.recurringFlows.retirementEligibleNetExternalAnnualCents, snapshot.baseCurrency),
      },
      retirement: retirement(snapshot.retirement, snapshot.baseCurrency),
    },
    contributionAssumption: {
      source: snapshot.annualContributions.source,
      derivedExternalAnnual: money(snapshot.annualContributions.derivedExternalAnnualCents, snapshot.baseCurrency),
      configuredOverrideAnnual: money(snapshot.annualContributions.overrideExternalAnnualCents, snapshot.baseCurrency),
      usedExternalAnnual: money(snapshot.annualContributions.usedExternalAnnualCents, snapshot.baseCurrency),
      internalReallocationAnnual: money(snapshot.annualContributions.internalReallocationAnnualCents, snapshot.baseCurrency),
    },
    dataQuality: dataQuality(snapshot.dataQuality),
    policyExceptionCount: snapshot.policyExceptions.length,
    returnedPolicyExceptionCount: exceptions.length,
    policyExceptionsTruncated: exceptions.length < snapshot.policyExceptions.length,
    policyExceptions: exceptions,
    limitations: [
      "Planning net worth is separate from the existing Nest dashboard net-worth semantics.",
      "Unknown and unclassified exposure remains explicit and is not inferred from product names.",
      "Results are deterministic decision support, not a trade, transfer, or security-specific instruction.",
    ],
  };
}

async function getCioOverview(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioAsOfArgsSchema.parse(rawArgs);
  const snapshot = await buildCioSnapshot({
    workspaceId: context.workspaceId,
    asOfDate: args.as_of_date ?? undefined,
  });
  return { output: overviewOutput(snapshot), evidence: toEvidence(snapshot.evidence, context.callId) };
}

async function getCioPolicyStatus(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioAsOfArgsSchema.parse(rawArgs);
  const [snapshot, configuredPolicy] = await Promise.all([
    buildCioSnapshot({ workspaceId: context.workspaceId, asOfDate: args.as_of_date ?? undefined }),
    getCioPolicy(context.workspaceId),
  ]);
  const exceptions = policyExceptions(snapshot.policyExceptions, snapshot.baseCurrency);
  return {
    output: {
      ok: true,
      readOnly: true,
      asOfDate: snapshot.asOfDate,
      currency: snapshot.baseCurrency,
      policyConfigured: configuredPolicy !== null,
      policyConfirmed: configuredPolicy?.confirmedAt !== null && configuredPolicy?.confirmedAt !== undefined,
      configuredPolicy: configuredPolicy ? {
        minimumLiquidityReserve: money(configuredPolicy.minimumLiquidityReserveCents, snapshot.baseCurrency),
        minimumLiquidityMonths: configuredPolicy.minimumLiquidityMonths,
        maximumAccountConcentration: percentage(configuredPolicy.maximumAccountConcentrationBps),
        maximumSingleSecurityConcentration: percentage(configuredPolicy.maximumSingleSecurityConcentrationBps),
        maximumSatelliteAllocation: percentage(configuredPolicy.maximumSatelliteAllocationBps),
        valuationStaleAfterDays: configuredPolicy.valuationStaleAfterDays,
        permissions: {
          options: configuredPolicy.allowsOptions,
          margin: configuredPolicy.allowsMargin,
          leverage: configuredPolicy.allowsLeverage,
          additionalIlpTopUps: configuredPolicy.allowsAdditionalIlpTopUps,
        },
        assetClassBands: configuredPolicy.assetClassBands.map((band) => ({
          assetClass: band.assetClass,
          minimum: percentage(band.minimumBps),
          target: percentage(band.targetBps),
          maximum: percentage(band.maximumBps),
        })),
        geographyLimits: configuredPolicy.geographyLimits.map((limit) => ({
          geography: limit.geography,
          maximum: percentage(limit.maximumBps),
        })),
      } : null,
      currentLiquidity: {
        immediate: money(snapshot.liquidity.immediateCents, snapshot.baseCurrency),
        readilyAvailable: money(snapshot.liquidity.readilyAvailableCents, snapshot.baseCurrency),
        emergencyRunwayMonths: snapshot.liquidity.emergencyRunwayMonths,
      },
      currentAllocation: allocations(snapshot),
      exceptionCount: snapshot.policyExceptions.length,
      returnedExceptionCount: exceptions.length,
      exceptionsTruncated: exceptions.length < snapshot.policyExceptions.length,
      exceptions,
      dataQuality: dataQuality(snapshot.dataQuality),
      limitation: "Policy exceptions are review prompts only; no trade, transfer, or order is produced.",
    },
    evidence: toEvidence(snapshot.evidence, context.callId),
  };
}

async function getCioStrategyRecommendations(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioAsOfArgsSchema.parse(rawArgs);
  const result = await buildWorkspaceCioStrategyRecommendations({
    workspaceId: context.workspaceId,
    asOfDate: args.as_of_date ?? undefined,
  });
  const recommendations = result.recommendations.map((item) => ({
    code: item.code,
    category: item.category,
    severity: item.severity,
    title: item.title,
    action: item.action,
    rationale: item.rationale,
    scopeKey: item.scopeKey,
    current: item.current?.unit === "CENTS"
      ? { label: item.current.label, amount: money(item.current.value, result.baseCurrency) }
      : item.current?.unit === "BPS"
        ? { label: item.current.label, percentage: percentage(item.current.value) }
        : item.current,
    target: item.target?.unit === "CENTS"
      ? { label: item.target.label, amount: money(item.target.value, result.baseCurrency) }
      : item.target?.unit === "BPS"
        ? { label: item.target.label, percentage: percentage(item.target.value) }
        : item.target,
    annualChange: money(item.annualChangeCents, result.baseCurrency),
    requiresUserConfirmation: item.requiresUserConfirmation,
  }));
  return {
    output: {
      ok: true,
      readOnly: true,
      asOfDate: result.asOfDate,
      currency: result.baseCurrency,
      recommendationCount: recommendations.length,
      recommendations,
      dataQuality: dataQuality(result.dataQuality),
      limitations: [
        "Recommendations are household strategy guidance derived from recorded data and confirmed policy.",
        "No trade, transfer, purchase, sale, or individual-security recommendation is generated.",
        "Every action requires household review and confirmation.",
      ],
    },
    evidence: toEvidence(result.evidence, context.callId),
  };
}

async function runCioRetirementProjection(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioRetirementArgsSchema.parse(rawArgs);
  const result = await runWorkspaceRetirementProjection({
    workspaceId: context.workspaceId,
    input: {
      ...(args.as_of_date ? { asOfDate: args.as_of_date } : {}),
      ...(args.annual_external_contribution_cents !== null
        ? { annualExternalContributionCents: args.annual_external_contribution_cents }
        : {}),
      ...(args.target_retirement_age !== null ? { targetRetirementAge: args.target_retirement_age } : {}),
      ...(args.target_retirement_date
        ? { targetRetirementDate: `${args.target_retirement_date}T00:00:00.000Z` }
        : {}),
    },
  });
  return {
    output: {
      ok: true,
      readOnly: true,
      asOfDate: result.asOfDate,
      currency: result.baseCurrency,
      temporaryOverrides: {
        annualExternalContribution: money(args.annual_external_contribution_cents, result.baseCurrency),
        targetRetirementAge: args.target_retirement_age,
        targetRetirementDate: args.target_retirement_date,
      },
      calculation: retirement(result.retirement, result.baseCurrency),
      dataQuality: dataQuality(result.dataQuality),
      limitation: "This deterministic scenario is not saved and does not execute a trade or transfer.",
    },
    evidence: toEvidence(result.evidence, context.callId),
  };
}

function baseScenario(status: CioRetirementStatus) {
  return status.status === "READY"
    ? status.projection.scenarios.find((scenario) => scenario.scenario === "BASE") ?? null
    : null;
}

async function compareCioContributionScenarios(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioContributionComparisonArgsSchema.parse(rawArgs);
  const baseline = await buildCioSnapshot({
    workspaceId: context.workspaceId,
    asOfDate: args.as_of_date ?? undefined,
  });
  const alternativeAnnualCents = z.number().int().min(-CIO_MAX_CENTS).max(CIO_MAX_CENTS).parse(
    baseline.annualContributions.usedExternalAnnualCents + args.additional_annual_contribution_cents,
  );
  const alternative = await runWorkspaceRetirementProjection({
    workspaceId: context.workspaceId,
    input: {
      ...(args.as_of_date ? { asOfDate: args.as_of_date } : {}),
      annualExternalContributionCents: alternativeAnnualCents,
    },
  });
  const baselineBase = baseScenario(baseline.retirement);
  const alternativeBase = baseScenario(alternative.retirement);
  const difference = baselineBase && alternativeBase ? {
    fundAtRetirementNominal: money(
      alternativeBase.fundAtRetirementNominalCents - baselineBase.fundAtRetirementNominalCents,
      baseline.baseCurrency,
    ),
    fundAtRetirementReal: money(
      alternativeBase.fundAtRetirementRealCents - baselineBase.fundAtRetirementRealCents,
      baseline.baseCurrency,
    ),
    sustainableMonthlyIncomeNominal: money(
      alternativeBase.sustainableMonthlyIncomeNominalCents - baselineBase.sustainableMonthlyIncomeNominalCents,
      baseline.baseCurrency,
    ),
    sustainableMonthlyIncomeReal: money(
      alternativeBase.sustainableMonthlyIncomeRealCents - baselineBase.sustainableMonthlyIncomeRealCents,
      baseline.baseCurrency,
    ),
    targetGapOrSurplusReal: money(
      alternativeBase.targetGapOrSurplusRealCents - baselineBase.targetGapOrSurplusRealCents,
      baseline.baseCurrency,
    ),
  } : null;

  return {
    output: {
      ok: true,
      readOnly: true,
      asOfDate: baseline.asOfDate,
      currency: baseline.baseCurrency,
      assumptions: {
        baselineContributionSource: baseline.annualContributions.source,
        baselineAnnualExternalContribution: money(baseline.annualContributions.usedExternalAnnualCents, baseline.baseCurrency),
        additionalAnnualExternalContribution: money(args.additional_annual_contribution_cents, baseline.baseCurrency),
        alternativeAnnualExternalContribution: money(alternativeAnnualCents, baseline.baseCurrency),
        internalReallocationsExcluded: money(baseline.annualContributions.internalReallocationAnnualCents, baseline.baseCurrency),
      },
      baseline: retirement(baseline.retirement, baseline.baseCurrency),
      alternative: retirement(alternative.retirement, alternative.baseCurrency),
      baseScenarioDifference: difference,
      dataQuality: dataQuality(baseline.dataQuality),
      limitation: "The comparison changes only the annual external-contribution assumption, is not saved, and executes nothing.",
    },
    evidence: toEvidence(baseline.evidence, context.callId),
  };
}

function recommendationOutput(item: CioStrategyRecommendation, currency: string) {
  return {
    code: item.code,
    category: item.category,
    severity: item.severity,
    title: item.title,
    action: item.action,
    rationale: item.rationale,
    scopeKey: item.scopeKey,
    current: strategyMetric(item.current, currency),
    target: strategyMetric(item.target, currency),
    annualChange: money(item.annualChangeCents, currency),
    monthlyChangeEquivalent: money(item.annualChangeCents === null ? null : monthlyEquivalentCents(item.annualChangeCents), currency),
    requiresUserConfirmation: item.requiresUserConfirmation,
  };
}

function strategyMetric(metric: CioStrategyRecommendation["current"], currency: string) {
  if (metric?.unit === "CENTS") return { label: metric.label, amount: money(metric.value, currency) };
  if (metric?.unit === "BPS") return { label: metric.label, percentage: percentage(metric.value) };
  return metric;
}

async function getCioAdvisorBrief(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioAsOfArgsSchema.parse(rawArgs);
  const brief = await buildWorkspaceCioAdvisorBrief({
    workspaceId: context.workspaceId,
    asOfDate: args.as_of_date ?? undefined,
  });
  const currency = brief.currency;
  const levers = brief.retirement.levers;
  const progress = brief.contributions.progress;
  return {
    output: {
      ok: true,
      readOnly: true,
      asOfDate: brief.asOfDate,
      currency,
      strategyStatus: brief.strategyStatus,
      executiveStance: brief.executiveStance,
      recommendations: brief.recommendations.map((item) => recommendationOutput(item, currency)),
      allocation: {
        policyConfirmed: brief.allocation.policyConfirmed,
        total: money(brief.allocation.totalCents, currency),
        unknownValue: money(brief.allocation.unknown.valueCents, currency),
        unknownAllocation: percentage(brief.allocation.unknown.allocationBps),
        drift: brief.allocation.drift.map((row) => ({
          assetClass: row.assetClass,
          status: row.status,
          current: money(row.currentCents, currency),
          currentAllocation: percentage(row.currentBps),
          minimum: percentage(row.minimumBps),
          target: percentage(row.targetBps),
          maximum: percentage(row.maximumBps),
          driftFromTarget: percentage(row.driftFromTargetBps),
          valueAtTarget: money(row.valueAtTargetCents, currency),
          differenceFromTarget: money(row.differenceFromTargetCents, currency),
        })),
        newMoneyToReachAllMinimums: money(brief.allocation.newMoneyToReachAllMinimumsCents, currency),
      },
      liquidity: {
        readilyAvailable: money(brief.liquidity.readilyAvailableCents, currency),
        immediateBankCash: money(brief.liquidity.immediateBankCashCents, currency),
        immediateBankCashFloor: money(brief.liquidity.immediateBankCashFloorCents, currency),
        immediateBankCashShortfall: money(brief.liquidity.immediateBankCashShortfallCents, currency),
        essentialMonthlyExpense: money(brief.liquidity.essentialMonthlyExpenseCents, currency),
        emergencyRunwayMonths: brief.liquidity.emergencyRunwayMonths,
        policyFloor: money(brief.liquidity.policyFloorCents, currency),
        policyShortfall: money(brief.liquidity.policyShortfallCents, currency),
        monthsToRestoreAtNetContributions: brief.liquidity.monthsToRestoreAtNetContributions,
        monthsToRestoreAssumption: "Assumes every recorded net external contribution is redirected to the reserve.",
      },
      contributions: {
        source: brief.contributions.source,
        usedAnnual: money(brief.contributions.usedAnnualCents, currency),
        usedMonthlyEquivalent: money(brief.contributions.usedMonthlyCents, currency),
        netExternalAnnual: money(brief.contributions.netExternalAnnualCents, currency),
        netExternalMonthlyEquivalent: money(brief.contributions.netExternalMonthlyCents, currency),
        internalReallocationsExcluded: money(brief.contributions.internalReallocationAnnualCents, currency),
        progress: progress ? {
          year: progress.year,
          status: progress.status,
          actualYearToDate: money(progress.actualYtdCents, currency),
          expectedToDate: money(progress.expectedToDateCents, currency),
          annualTarget: money(progress.annualTargetCents, currency),
          paceGap: money(progress.paceGapCents, currency),
          remainingThisYear: money(progress.remainingAnnualCents, currency),
          annualProgress: percentage(progress.annualProgressBps),
          calendarProgress: percentage(progress.calendarProgressBps),
        } : null,
      },
      retirement: {
        status: brief.retirement.status,
        missingFields: brief.retirement.missingFields,
        levers: levers ? {
          retirementDate: levers.retirementDate,
          currentAnnualContribution: money(levers.currentAnnualContributionCents, currency),
          currentMonthlyContributionEquivalent: money(levers.currentMonthlyContributionCents, currency),
          requiredAnnualContribution: money(levers.requiredAnnualContributionCents, currency),
          requiredMonthlyContributionEquivalent: money(levers.requiredMonthlyContributionCents, currency),
          additionalAnnualContributionNeeded: money(levers.additionalAnnualContributionCents, currency),
          additionalMonthlyContributionNeeded: money(levers.additionalMonthlyContributionCents, currency),
          baseGapOrSurplusReal: money(levers.baseGapOrSurplusRealCents, currency),
          baseSustainableMonthlyIncomeReal: money(levers.baseSustainableMonthlyIncomeRealCents, currency),
          targetMonthlySpendingToday: money(levers.targetMonthlySpendingTodayCents, currency),
          monthlySpendingGapOrSurplusToday: money(levers.monthlySpendingGapOrSurplusTodayCents, currency),
          earliestFundedRetirementDate: levers.earliestFundedRetirementDate,
          earliestFundedDateSearch: levers.earliestFundedDateSearch,
          requiredBaseReturnStatus: levers.requiredBaseReturn.status,
          requiredBaseReturn: percentage(levers.requiredBaseReturn.bps),
          configuredBaseReturn: percentage(levers.baseReturnBps),
          requiredContributionUnavailable: levers.requiredAnnualContributionCents === null,
        } : null,
      },
      dataQuality: dataQuality(brief.dataQuality),
      limitations: [
        "Monthly figures are exact equivalents of annual amounts, rounded to the cent by Nest.",
        "Retirement levers change one assumption at a time on the deterministic base scenario and are not saved.",
        "No trade, transfer, sale, or individual-security recommendation is generated. Every action requires household confirmation.",
      ],
    },
    evidence: toEvidence(brief.evidence, context.callId),
  };
}

async function planCioNewMoney(rawArgs: unknown, context: CioToolContext): Promise<CioToolResult> {
  const args = CioNewMoneyArgsSchema.parse(rawArgs);
  const result = await planWorkspaceCioNewMoney({
    workspaceId: context.workspaceId,
    amountCents: args.amount_cents,
    asOfDate: args.as_of_date ?? undefined,
  });
  const currency = result.baseCurrency;
  const plan = result.plan;
  return {
    output: {
      ok: true,
      readOnly: true,
      asOfDate: result.asOfDate,
      currency,
      proposedNewMoney: money(args.amount_cents, currency),
      plan: plan.status === "POLICY_REQUIRED" ? plan : {
        status: plan.status,
        method: plan.method,
        totalBefore: money(plan.totalBeforeCents, currency),
        totalAfter: money(plan.totalAfterCents, currency),
        unknownValue: money(plan.unknown.valueCents, currency),
        unknownAllocation: percentage(plan.unknown.allocationBps),
        bands: plan.bands.map((row) => ({
          assetClass: row.assetClass,
          allocate: money(row.allocationCents, currency),
          shareOfNewMoney: percentage(row.allocationShareBps),
          before: money(row.currentCents, currency),
          beforeAllocation: percentage(row.currentBps),
          after: money(row.afterCents, currency),
          afterAllocation: percentage(row.afterBps),
          minimum: percentage(row.minimumBps),
          target: percentage(row.targetBps),
          maximum: percentage(row.maximumBps),
          statusBefore: row.statusBefore,
          statusAfter: row.statusAfter,
        })),
        stillOutsideBands: plan.stillOutsideBands,
      },
      dataQuality: dataQuality(result.dataQuality),
      limitation: "Asset-class routing only. Nest does not choose products or securities, sell holdings, or save or execute this plan.",
    },
    evidence: toEvidence(result.evidence, context.callId),
  };
}

export async function executeCioAskNestTool(
  name: string,
  rawArgs: unknown,
  context: CioToolContext,
): Promise<CioToolResult | null> {
  try {
    let result: CioToolResult;
    switch (name) {
      case "get_cio_overview":
        result = await getCioOverview(rawArgs, context);
        break;
      case "get_cio_policy_status":
        result = await getCioPolicyStatus(rawArgs, context);
        break;
      case "get_cio_strategy_recommendations":
        result = await getCioStrategyRecommendations(rawArgs, context);
        break;
      case "run_cio_retirement_projection":
        result = await runCioRetirementProjection(rawArgs, context);
        break;
      case "compare_cio_contribution_scenarios":
        result = await compareCioContributionScenarios(rawArgs, context);
        break;
      case "get_cio_advisor_brief":
        result = await getCioAdvisorBrief(rawArgs, context);
        break;
      case "plan_cio_new_money":
        result = await planCioNewMoney(rawArgs, context);
        break;
      default:
        return null;
    }
    return {
      output: {
        ...result.output,
        domain: "CIO",
        evidence: result.evidence,
      },
      evidence: result.evidence,
    };
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error;
    return {
      output: {
        ok: false,
        domain: "CIO",
        readOnly: true,
        unavailable: true,
        code: "CIO_REQUEST_UNAVAILABLE",
        error: "Nest could not safely evaluate this CIO request with the available workspace data.",
      },
      evidence: [],
    };
  }
}
