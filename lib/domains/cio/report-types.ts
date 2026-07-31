import { z } from "zod";
import { CIO_STRATEGY_RECOMMENDATION_CODES } from "./strategy-recommendations";

const MetricSchema = z.object({
  unit: z.enum(["CENTS", "BPS", "MONTHS", "COUNT"]),
  value: z.number().int(),
  label: z.string().min(1).max(120),
}).strict();

export const CioStrategyRecommendationSchema = z.object({
  id: z.string().min(1).max(180),
  code: z.enum(CIO_STRATEGY_RECOMMENDATION_CODES),
  category: z.enum(["DATA_QUALITY", "LIQUIDITY", "ALLOCATION", "CONCENTRATION", "RETIREMENT"]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  priority: z.number().int().min(0).max(1_000),
  title: z.string().min(1).max(240),
  action: z.string().min(1).max(1_000),
  rationale: z.string().min(1).max(1_000),
  scopeKey: z.string().max(120).nullable(),
  current: MetricSchema.nullable(),
  target: MetricSchema.nullable(),
  annualChangeCents: z.number().int().nullable(),
  evidenceIds: z.array(z.string().min(1).max(180)).max(8),
  requiresUserConfirmation: z.literal(true),
}).strict();

const AllocationBucketSchema = z.object({
  key: z.string().min(1).max(64),
  valueCents: z.number().int(),
  allocationBps: z.number().int(),
  isUnknown: z.boolean(),
}).strict();

const ReportEvidenceSchema = z.object({
  id: z.string().min(1).max(180),
  kind: z.string().min(1).max(64),
  label: z.string().min(1).max(240),
  href: z.string().min(1).max(1_000),
  asOfDate: z.string().date(),
}).strict();

const ReportPolicySchema = z.object({
  confirmed: z.boolean(),
  minimumLiquidityReserveCents: z.number().int().nullable(),
  minimumLiquidityMonths: z.number().int().nullable(),
  maximumAccountConcentrationBps: z.number().int().nullable(),
  maximumSingleSecurityConcentrationBps: z.number().int().nullable(),
  maximumSatelliteAllocationBps: z.number().int().nullable(),
  assetClassBands: z.array(z.object({
    assetClass: z.string().min(1).max(32),
    minimumBps: z.number().int(),
    targetBps: z.number().int(),
    maximumBps: z.number().int(),
  }).strict()).max(16),
  geographyLimits: z.array(z.object({
    geography: z.string().min(1).max(32),
    maximumBps: z.number().int(),
  }).strict()).max(16),
}).strict();

const ReportRetirementSchema = z.object({
  status: z.enum(["READY", "NOT_READY"]),
  missingFields: z.array(z.string().min(1).max(120)).max(40),
  retirementDate: z.string().date().nullable(),
  targetMonthlySpendingCents: z.number().int().nullable(),
  currentAnnualContributionCents: z.number().int().nullable(),
  requiredAnnualContributionCents: z.number().int().nullable(),
  inflationRateBps: z.number().int().nullable(),
  sustainableWithdrawalRateBps: z.number().int().nullable(),
  scenarios: z.array(z.object({
    scenario: z.enum(["BEAR", "BASE", "BULL"]),
    nominalReturnBps: z.number().int(),
    fundAtRetirementRealCents: z.number().int(),
    sustainableMonthlyIncomeRealCents: z.number().int(),
    targetFundRealCents: z.number().int(),
    targetGapOrSurplusRealCents: z.number().int(),
  }).strict()).max(3),
}).strict();

export const CioStrategyReportModelSchema = z.object({
  schemaVersion: z.literal("1.0"),
  rendererVersion: z.literal("1.0"),
  generatedAt: z.string().datetime(),
  asOfDate: z.string().date(),
  reviewByDate: z.string().date(),
  title: z.string().min(1).max(240),
  workspaceName: z.string().min(1).max(240),
  baseCurrency: z.string().min(3).max(3),
  strategyStatus: z.enum(["SETUP_REQUIRED", "ACTION_REQUIRED", "ON_TRACK"]),
  executiveStance: z.string().min(1).max(1_000),
  keyMessages: z.array(z.string().min(1).max(500)).min(1).max(5),
  totals: z.object({
    financialAssetsCents: z.number().int(),
    planningAssetsCents: z.number().int(),
    planningLiabilitiesCents: z.number().int(),
    planningNetWorthCents: z.number().int(),
    investableAssetsCents: z.number().int(),
    retirementIncludedAssetsCents: z.number().int(),
  }).strict(),
  allocation: z.object({
    assetClasses: z.array(AllocationBucketSchema).max(16),
    geographies: z.array(AllocationBucketSchema).max(16),
  }).strict(),
  liquidity: z.object({
    immediateCents: z.number().int(),
    liquidCents: z.number().int(),
    restrictedCents: z.number().int(),
    lockedCents: z.number().int(),
    readilyAvailableCents: z.number().int(),
    essentialMonthlyExpenseCents: z.number().int().nullable(),
    emergencyRunwayMonths: z.number().nullable(),
  }).strict(),
  contributions: z.object({
    externalContributionAnnualCents: z.number().int(),
    externalWithdrawalAnnualCents: z.number().int(),
    netExternalContributionAnnualCents: z.number().int(),
    internalReallocationAnnualCents: z.number().int(),
    retirementContributionAnnualCents: z.number().int(),
    source: z.enum(["DERIVED", "OVERRIDE"]),
  }).strict(),
  investments: z.array(z.object({
    id: z.string().min(1).max(1_000),
    label: z.string().min(1).max(320),
    institutionName: z.string().min(1).max(240),
    productName: z.string().min(1).max(240),
    currentValueCents: z.number().int().nullable(),
    portfolioRole: z.string().max(32).nullable(),
    liquidityClass: z.string().min(1).max(32),
    classificationStatus: z.string().min(1).max(32),
  }).strict()).max(500),
  policy: ReportPolicySchema,
  retirement: ReportRetirementSchema,
  recommendations: z.array(CioStrategyRecommendationSchema).max(12),
  policyExceptions: z.array(z.object({
    code: z.string().min(1).max(80),
    severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
    title: z.string().min(1).max(240),
    reviewAction: z.string().min(1).max(1_000),
  }).strict()).max(30),
  dataQuality: z.object({
    completenessBps: z.number().int().min(0).max(10_000),
    latestValuationDate: z.string().date().nullable(),
    oldestValuationDate: z.string().date().nullable(),
    warnings: z.array(z.object({
      code: z.string().min(1).max(80),
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
      message: z.string().min(1).max(1_000),
    }).strict()).max(50),
  }).strict(),
  evidence: z.array(ReportEvidenceSchema).max(50),
  methodology: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  limitations: z.array(z.string().min(1).max(1_000)).min(1).max(20),
}).strict();

export const CioStrategyReportSummarySchema = z.object({
  id: z.string().min(1).max(1_000),
  title: z.string().min(1).max(240),
  asOfDate: z.string().date(),
  generatedAt: z.string().datetime(),
  strategyStatus: z.enum(["SETUP_REQUIRED", "ACTION_REQUIRED", "ON_TRACK"]),
  completenessBps: z.number().int().min(0).max(10_000),
  recommendationCount: z.number().int().min(0).max(12),
  topRecommendations: z.array(CioStrategyRecommendationSchema).max(3),
}).strict();

export type CioStrategyReportModel = z.infer<typeof CioStrategyReportModelSchema>;
export type CioStrategyReportSummary = z.infer<typeof CioStrategyReportSummarySchema>;
