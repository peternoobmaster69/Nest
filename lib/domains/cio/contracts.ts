import { z } from "zod";
import {
  CIO_ASSET_CLASSES,
  CIO_CLASSIFICATION_STATUSES,
  CIO_EXPOSURE_DIMENSIONS,
  CIO_FLOW_CADENCES,
  CIO_FLOW_TYPES,
  CIO_GEOGRAPHIES,
  CIO_LIQUIDITY_CLASSES,
  CIO_PORTFOLIO_ROLES,
  CIO_POSITION_SIDES,
  CIO_PLANNING_SCOPES,
  CIO_RISK_LEVELS,
} from "./types";

export const CIO_MAX_CENTS = 2_147_483_647;
export const CIO_MAX_RATE_BPS = 100_000;
export const CIO_MIN_RATE_BPS = -10_000;
export const CIO_MAX_PROJECTION_YEARS = 100;
export const CIO_MAX_EXPOSURES = 100;
export const CIO_MAX_LIST_ITEMS = 500;

const NullableDateTimeSchema = z.iso.datetime().nullable();
const NullableCentsSchema = z.number().int().min(0).max(CIO_MAX_CENTS).nullable();
const NullableRateBpsSchema = z.number().int().min(CIO_MIN_RATE_BPS).max(CIO_MAX_RATE_BPS).nullable();
const NullableInflationRateBpsSchema = z.number().int().min(CIO_MIN_RATE_BPS + 1).max(CIO_MAX_RATE_BPS).nullable();
const NullableBpsSchema = z.number().int().min(0).max(10_000).nullable();
const OptionalNotesSchema = z.string().trim().max(1_000).nullable().optional();
export const CioBoundedIdSchema = z.string().trim().min(1).max(1_000);
const DateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Expected a valid calendar date");

export const CioProfileInputSchema = z.object({
  planningScope: z.enum(CIO_PLANNING_SCOPES).optional(),
  primaryBirthDate: NullableDateTimeSchema.optional(),
  primaryCurrentAge: z.number().int().min(0).max(120).nullable().optional(),
  primaryAgeAsOfDate: NullableDateTimeSchema.optional(),
  partnerBirthDate: NullableDateTimeSchema.optional(),
  targetRetirementAge: z.number().int().min(18).max(120).nullable().optional(),
  targetRetirementDate: NullableDateTimeSchema.optional(),
  targetMonthlyRetirementSpendingCents: NullableCentsSchema.optional(),
  essentialMonthlySpendingCents: NullableCentsSchema.optional(),
  minimumImmediateBankCashCents: NullableCentsSchema.optional(),
  inflationRateBps: NullableInflationRateBpsSchema.optional(),
  bearReturnBps: NullableRateBpsSchema.optional(),
  baseReturnBps: NullableRateBpsSchema.optional(),
  bullReturnBps: NullableRateBpsSchema.optional(),
  sustainableWithdrawalRateBps: z.number().int().min(1).max(10_000).nullable().optional(),
  annualExternalContributionOverrideCents: NullableCentsSchema.optional(),
  contributionGrowthRateBps: NullableRateBpsSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.planningScope === "INDIVIDUAL" && value.partnerBirthDate) {
    ctx.addIssue({ code: "custom", path: ["partnerBirthDate"], message: "Partner birth date is only used for household planning." });
  }
  if (value.primaryBirthDate && value.primaryCurrentAge !== undefined && value.primaryCurrentAge !== null) {
    ctx.addIssue({ code: "custom", path: ["primaryCurrentAge"], message: "Use either primary birth date or current age, not both." });
  }
  if (value.primaryCurrentAge !== undefined && value.primaryCurrentAge !== null && value.primaryAgeAsOfDate === null) {
    ctx.addIssue({ code: "custom", path: ["primaryAgeAsOfDate"], message: "An age as-of date is required with current age." });
  }
  if (value.targetRetirementAge !== undefined && value.targetRetirementAge !== null && value.targetRetirementDate) {
    ctx.addIssue({ code: "custom", path: ["targetRetirementDate"], message: "Use either target retirement age or target date, not both." });
  }
  if (
    value.bearReturnBps !== undefined && value.bearReturnBps !== null &&
    value.baseReturnBps !== undefined && value.baseReturnBps !== null &&
    value.bearReturnBps > value.baseReturnBps
  ) {
    ctx.addIssue({ code: "custom", path: ["bearReturnBps"], message: "Bear return cannot exceed base return." });
  }
  if (
    value.baseReturnBps !== undefined && value.baseReturnBps !== null &&
    value.bullReturnBps !== undefined && value.bullReturnBps !== null &&
    value.baseReturnBps > value.bullReturnBps
  ) {
    ctx.addIssue({ code: "custom", path: ["bullReturnBps"], message: "Bull return cannot be below base return." });
  }
});

export const CioPolicyAssetClassBandSchema = z.object({
  assetClass: z.enum(CIO_ASSET_CLASSES),
  minimumBps: z.number().int().min(0).max(10_000),
  targetBps: z.number().int().min(0).max(10_000),
  maximumBps: z.number().int().min(0).max(10_000),
}).strict().superRefine((value, ctx) => {
  if (value.minimumBps > value.targetBps || value.targetBps > value.maximumBps) {
    ctx.addIssue({ code: "custom", path: ["targetBps"], message: "Allocation band must satisfy minimum <= target <= maximum." });
  }
});

export const CioPolicyGeographyLimitSchema = z.object({
  geography: z.enum(CIO_GEOGRAPHIES),
  maximumBps: z.number().int().min(0).max(10_000),
}).strict();

function addUniqueKeyIssue<T extends Record<string, unknown>>(
  values: readonly T[] | undefined,
  key: keyof T,
  path: string,
  ctx: z.RefinementCtx,
) {
  if (!values) return;
  const seen = new Set<unknown>();
  for (const [index, item] of values.entries()) {
    const value = item[key];
    if (seen.has(value)) ctx.addIssue({ code: "custom", path: [path, index, String(key)], message: "Duplicate key." });
    seen.add(value);
  }
}

export const CioPolicyInputSchema = z.object({
  minimumLiquidityReserveCents: NullableCentsSchema.optional(),
  minimumLiquidityMonths: z.number().int().min(0).max(120).nullable().optional(),
  maximumAccountConcentrationBps: NullableBpsSchema.optional(),
  maximumSingleSecurityConcentrationBps: NullableBpsSchema.optional(),
  maximumSatelliteAllocationBps: NullableBpsSchema.optional(),
  valuationStaleAfterDays: z.number().int().min(1).max(3_650).optional(),
  allowsOptions: z.boolean().nullable().optional(),
  allowsMargin: z.boolean().nullable().optional(),
  allowsLeverage: z.boolean().nullable().optional(),
  allowsAdditionalIlpTopUps: z.boolean().nullable().optional(),
  confirmedAt: NullableDateTimeSchema.optional(),
  assetClassBands: z.array(CioPolicyAssetClassBandSchema).max(CIO_ASSET_CLASSES.length).optional(),
  geographyLimits: z.array(CioPolicyGeographyLimitSchema).max(CIO_GEOGRAPHIES.length).optional(),
}).strict().superRefine((value, ctx) => {
  addUniqueKeyIssue(value.assetClassBands, "assetClass", "assetClassBands", ctx);
  addUniqueKeyIssue(value.geographyLimits, "geography", "geographyLimits", ctx);
});

export const CioInvestmentProfileInputSchema = z.object({
  liquidityClass: z.enum(CIO_LIQUIDITY_CLASSES),
  portfolioRole: z.enum(CIO_PORTFOLIO_ROLES),
  riskLevel: z.enum(CIO_RISK_LEVELS),
  includeInRetirementProjection: z.boolean(),
  lockUntil: NullableDateTimeSchema.optional(),
  classificationStatus: z.enum(CIO_CLASSIFICATION_STATUSES),
  classificationSource: z.string().trim().min(1).max(32).regex(/^[A-Z0-9_-]+$/),
  notes: OptionalNotesSchema,
}).strict().superRefine((value, ctx) => {
  if (value.liquidityClass !== "LOCKED" && value.lockUntil) {
    ctx.addIssue({ code: "custom", path: ["lockUntil"], message: "A lock-until date is only valid for locked investments." });
  }
});

export const CioExposureInputSchema = z.object({
  dimension: z.enum(CIO_EXPOSURE_DIMENSIONS),
  key: z.string().trim().min(1).max(64),
  weightBps: z.number().int().min(1).max(10_000),
}).strict().superRefine((value, ctx) => {
  if (value.dimension === "ASSET_CLASS" && !(CIO_ASSET_CLASSES as readonly string[]).includes(value.key)) {
    ctx.addIssue({ code: "custom", path: ["key"], message: "Unsupported asset class." });
  }
  if (value.dimension === "GEOGRAPHY" && !(CIO_GEOGRAPHIES as readonly string[]).includes(value.key)) {
    ctx.addIssue({ code: "custom", path: ["key"], message: "Unsupported geography." });
  }
  if (value.dimension === "SECURITY" && !/^[A-Z0-9][A-Z0-9._:-]{0,31}$/.test(value.key)) {
    ctx.addIssue({ code: "custom", path: ["key"], message: "Security keys must be uppercase bounded ticker-like identifiers." });
  }
});

export const CioExposuresInputSchema = z.object({
  exposures: z.array(CioExposureInputSchema).max(CIO_MAX_EXPOSURES),
}).strict().superRefine((value, ctx) => {
  const totals = new Map<string, number>();
  const unique = new Set<string>();
  for (let index = 0; index < value.exposures.length; index += 1) {
    const exposure = value.exposures[index];
    const identity = `${exposure.dimension}:${exposure.key}`;
    if (unique.has(identity)) ctx.addIssue({ code: "custom", path: ["exposures", index, "key"], message: "Duplicate exposure key for dimension." });
    unique.add(identity);
    totals.set(exposure.dimension, (totals.get(exposure.dimension) ?? 0) + exposure.weightBps);
  }
  for (const [dimension, total] of totals) {
    if (total !== 10_000) ctx.addIssue({ code: "custom", path: ["exposures"], message: `${dimension} weights must total exactly 10000 basis points.` });
  }
});

const CioRecurringFlowFields = {
  type: z.enum(CIO_FLOW_TYPES),
  sourceFinancialAccountId: CioBoundedIdSchema.nullable().optional(),
  sourceInvestmentAccountId: CioBoundedIdSchema.nullable().optional(),
  destinationInvestmentAccountId: CioBoundedIdSchema.nullable().optional(),
  amountCents: z.number().int().min(1).max(CIO_MAX_CENTS),
  cadence: z.enum(CIO_FLOW_CADENCES),
  startsOn: z.iso.datetime(),
  endsOn: NullableDateTimeSchema.optional(),
  includeInRetirementProjection: z.boolean(),
  label: z.string().trim().min(1).max(160),
  notes: OptionalNotesSchema,
};

type FlowReferenceInput = {
  type?: string;
  sourceFinancialAccountId?: string | null;
  sourceInvestmentAccountId?: string | null;
  destinationInvestmentAccountId?: string | null;
  startsOn?: string;
  endsOn?: string | null;
};

function refineFlowReferences(value: FlowReferenceInput, ctx: z.RefinementCtx) {
  const hasSource = Boolean(value.sourceFinancialAccountId || value.sourceInvestmentAccountId);
  const hasDestination = Boolean(value.destinationInvestmentAccountId);
  if (value.sourceFinancialAccountId && value.sourceInvestmentAccountId) {
    ctx.addIssue({ code: "custom", path: ["sourceInvestmentAccountId"], message: "A flow can have only one source account reference." });
  }
  if (value.startsOn && value.endsOn && new Date(value.endsOn).getTime() < new Date(value.startsOn).getTime()) {
    ctx.addIssue({ code: "custom", path: ["endsOn"], message: "End date cannot precede start date." });
  }
  if (value.sourceInvestmentAccountId && value.sourceInvestmentAccountId === value.destinationInvestmentAccountId) {
    ctx.addIssue({ code: "custom", path: ["destinationInvestmentAccountId"], message: "A flow cannot reallocate an investment to itself." });
  }
  if (value.type === "EXTERNAL_CONTRIBUTION" && hasSource) {
    ctx.addIssue({ code: "custom", path: ["type"], message: "Money sourced from an existing Nest account is an internal reallocation, not a new external contribution." });
  }
  if (value.type !== undefined && value.type !== "INTERNAL_REALLOCATION" && hasSource && hasDestination) {
    ctx.addIssue({ code: "custom", path: ["type"], message: "A flow between existing Nest holdings must be an internal reallocation." });
  }
}

function refineCompleteFlowReferences(value: FlowReferenceInput, ctx: z.RefinementCtx) {
  refineFlowReferences(value, ctx);
  const hasSource = Boolean(value.sourceFinancialAccountId || value.sourceInvestmentAccountId);
  const hasDestination = Boolean(value.destinationInvestmentAccountId);
  if (value.type === "INTERNAL_REALLOCATION" && (!hasSource || !hasDestination)) {
    ctx.addIssue({ code: "custom", path: ["type"], message: "An internal reallocation requires one existing source and a destination investment." });
  }
}

export const CioRecurringFlowCreateSchema = z.object(CioRecurringFlowFields).strict().superRefine(refineCompleteFlowReferences);
export const CioRecurringFlowUpdateSchema = z.object(CioRecurringFlowFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "At least one recurring-flow field is required.")
  .superRefine(refineFlowReferences);

const CioPlanningPositionFields = {
  side: z.enum(CIO_POSITION_SIDES),
  category: z.string().trim().min(1).max(48).regex(/^[A-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(160),
  currentValueCents: z.number().int().min(0).max(CIO_MAX_CENTS),
  asOfDate: z.iso.datetime(),
  liquidityClass: z.enum(CIO_LIQUIDITY_CLASSES),
  includeInInvestableAllocation: z.boolean(),
  includeInRetirementProjection: z.boolean(),
  notes: OptionalNotesSchema,
};

function refinePlanningPosition(value: {
  side?: string;
  includeInInvestableAllocation?: boolean;
  includeInRetirementProjection?: boolean;
}, ctx: z.RefinementCtx) {
  if (value.side === "LIABILITY" && (value.includeInInvestableAllocation || value.includeInRetirementProjection)) {
    ctx.addIssue({ code: "custom", path: ["side"], message: "Liabilities cannot be included in investable or retirement assets." });
  }
}

export const CioPlanningPositionCreateSchema = z.object(CioPlanningPositionFields).strict().superRefine(refinePlanningPosition);
export const CioPlanningPositionUpdateSchema = z.object(CioPlanningPositionFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "At least one planning-position field is required.")
  .superRefine(refinePlanningPosition);

export const CioRetirementProjectionInputSchema = z.object({
  asOfDate: DateOnlySchema.optional(),
  currentRetirementAssetsCents: z.number().int().min(0).max(CIO_MAX_CENTS).optional(),
  annualExternalContributionCents: z.number().int().min(-CIO_MAX_CENTS).max(CIO_MAX_CENTS).optional(),
  contributionGrowthRateBps: z.number().int().min(CIO_MIN_RATE_BPS).max(CIO_MAX_RATE_BPS).optional(),
  inflationRateBps: z.number().int().min(CIO_MIN_RATE_BPS + 1).max(CIO_MAX_RATE_BPS).optional(),
  bearReturnBps: z.number().int().min(CIO_MIN_RATE_BPS).max(CIO_MAX_RATE_BPS).optional(),
  baseReturnBps: z.number().int().min(CIO_MIN_RATE_BPS).max(CIO_MAX_RATE_BPS).optional(),
  bullReturnBps: z.number().int().min(CIO_MIN_RATE_BPS).max(CIO_MAX_RATE_BPS).optional(),
  targetRetirementDate: z.iso.datetime().optional(),
  targetRetirementAge: z.number().int().min(18).max(120).optional(),
  targetMonthlySpendingTodayCents: z.number().int().min(0).max(CIO_MAX_CENTS).optional(),
  sustainableWithdrawalRateBps: z.number().int().min(1).max(10_000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.targetRetirementDate !== undefined && value.targetRetirementAge !== undefined) {
    ctx.addIssue({ code: "custom", path: ["targetRetirementAge"], message: "Use either target retirement age or target date, not both." });
  }
  if (value.bearReturnBps !== undefined && value.baseReturnBps !== undefined && value.bearReturnBps > value.baseReturnBps) {
    ctx.addIssue({ code: "custom", path: ["bearReturnBps"], message: "Bear return cannot exceed base return." });
  }
  if (value.baseReturnBps !== undefined && value.bullReturnBps !== undefined && value.baseReturnBps > value.bullReturnBps) {
    ctx.addIssue({ code: "custom", path: ["bullReturnBps"], message: "Bull return cannot be below base return." });
  }
});

export const CioStrategyReportCreateInputSchema = z.object({
  asOfDate: DateOnlySchema.optional(),
}).strict();

export type CioProfileInput = z.infer<typeof CioProfileInputSchema>;
export type CioPolicyInput = z.infer<typeof CioPolicyInputSchema>;
export type CioInvestmentProfileInput = z.infer<typeof CioInvestmentProfileInputSchema>;
export type CioExposuresInput = z.infer<typeof CioExposuresInputSchema>;
export type CioRecurringFlowCreateInput = z.infer<typeof CioRecurringFlowCreateSchema>;
export type CioRecurringFlowUpdateInput = z.infer<typeof CioRecurringFlowUpdateSchema>;
export type CioPlanningPositionCreateInput = z.infer<typeof CioPlanningPositionCreateSchema>;
export type CioPlanningPositionUpdateInput = z.infer<typeof CioPlanningPositionUpdateSchema>;
export type CioRetirementProjectionInput = z.infer<typeof CioRetirementProjectionInputSchema>;
export type CioStrategyReportCreateInput = z.infer<typeof CioStrategyReportCreateInputSchema>;
