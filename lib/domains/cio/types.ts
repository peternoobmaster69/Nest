export const CIO_ASSET_CLASSES = [
  "CASH",
  "FIXED_INCOME",
  "EQUITY",
  "REIT",
  "COMMODITY",
  "PROPERTY",
  "ALTERNATIVE",
  "UNKNOWN",
] as const;

export const CIO_GEOGRAPHIES = [
  "SINGAPORE",
  "UNITED_STATES",
  "CHINA",
  "DEVELOPED_EX_US",
  "EMERGING_EX_CHINA",
  "GLOBAL",
  "UNKNOWN",
] as const;

export const CIO_LIQUIDITY_CLASSES = ["IMMEDIATE", "LIQUID", "RESTRICTED", "LOCKED"] as const;
export const CIO_PORTFOLIO_ROLES = ["EMERGENCY", "CORE", "STABILIZER", "SATELLITE", "GOAL", "OTHER"] as const;
export const CIO_RISK_LEVELS = ["LOW", "MODERATE", "HIGH", "VERY_HIGH", "UNKNOWN"] as const;
export const CIO_CLASSIFICATION_STATUSES = ["UNCLASSIFIED", "SUGGESTED", "USER_CONFIRMED"] as const;
export const CIO_EXPOSURE_DIMENSIONS = ["ASSET_CLASS", "GEOGRAPHY", "SECURITY"] as const;
export const CIO_POSITION_SIDES = ["ASSET", "LIABILITY"] as const;
export const CIO_FLOW_TYPES = ["EXTERNAL_CONTRIBUTION", "INTERNAL_REALLOCATION", "EXTERNAL_WITHDRAWAL"] as const;
export const CIO_FLOW_CADENCES = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export const CIO_PLANNING_SCOPES = ["INDIVIDUAL", "HOUSEHOLD"] as const;

export type CioAssetClass = (typeof CIO_ASSET_CLASSES)[number];
export type CioGeography = (typeof CIO_GEOGRAPHIES)[number];
export type CioLiquidityClass = (typeof CIO_LIQUIDITY_CLASSES)[number];
export type CioPortfolioRole = (typeof CIO_PORTFOLIO_ROLES)[number];
export type CioRiskLevel = (typeof CIO_RISK_LEVELS)[number];
export type CioClassificationStatus = (typeof CIO_CLASSIFICATION_STATUSES)[number];
export type CioExposureDimension = (typeof CIO_EXPOSURE_DIMENSIONS)[number];
export type CioPositionSide = (typeof CIO_POSITION_SIDES)[number];
export type CioFlowType = (typeof CIO_FLOW_TYPES)[number];
export type CioFlowCadence = (typeof CIO_FLOW_CADENCES)[number];
export type CioPlanningScope = (typeof CIO_PLANNING_SCOPES)[number];

export type CioEvidenceRef = {
  id: string;
  kind: "WORKSPACE" | "BANK_CONTROL" | "SAVINGS_SUB_ACCOUNT" | "INVESTMENT_VALUATION" | "CIO_PROFILE" | "CIO_POLICY" | "PLANNING_POSITION" | "RECURRING_FLOW";
  label: string;
  href: string;
  asOfDate: string;
};

export type CioAllocationBucket = {
  key: string;
  valueCents: number;
  allocationBps: number;
  sourceCount: number;
  isUnknown: boolean;
};

export type CioAllocationSummary = {
  totalCents: number;
  assetClasses: CioAllocationBucket[];
  geographies: CioAllocationBucket[];
  securities: CioAllocationBucket[];
  securityBucketCount: number;
  securitiesTruncated: boolean;
  omittedSecurityValueCents: number;
  omittedSecurityAllocationBps: number;
};

export type CioLiquiditySummary = {
  immediateCents: number;
  liquidCents: number;
  restrictedCents: number;
  lockedCents: number;
  readilyAvailableCents: number;
  essentialMonthlyExpenseCents: number | null;
  emergencyRunwayMonths: number | null;
};

export type CioRecurringFlowBreakdown = {
  id: string;
  label: string;
  type: CioFlowType;
  cadence: CioFlowCadence;
  amountCents: number;
  annualizedCents: number;
  includeInRetirementProjection: boolean;
};

export type CioRecurringFlowSummary = {
  externalContributionAnnualCents: number;
  externalWithdrawalAnnualCents: number;
  netExternalContributionAnnualCents: number;
  internalReallocationAnnualCents: number;
  retirementEligibleNetExternalAnnualCents: number;
  breakdown: CioRecurringFlowBreakdown[];
};

export type CioPolicyExceptionCode =
  | "DATA_INCOMPLETE"
  | "STALE_VALUATION"
  | "LIQUIDITY_BELOW_FLOOR"
  | "ASSET_CLASS_OUTSIDE_BAND"
  | "ACCOUNT_CONCENTRATION"
  | "SECURITY_CONCENTRATION"
  | "GEOGRAPHY_CONCENTRATION"
  | "SATELLITE_ALLOCATION_EXCEEDED"
  | "RETIREMENT_TARGET_GAP";

export type CioPolicyException = {
  code: CioPolicyExceptionCode;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  actual: { unit: "CENTS" | "BPS" | "MONTHS" | "DAYS" | "COUNT"; value: number | null };
  threshold: { unit: "CENTS" | "BPS" | "MONTHS" | "DAYS" | "COUNT"; value: number | null } | null;
  evidence: CioEvidenceRef[];
  reviewAction: string;
};

export type CioDataQualityWarning = {
  code: "MISSING_VALUATION" | "NEGATIVE_VALUATION" | "BANK_BALANCE_AFTER_DATA_DATE" | "SAVINGS_BALANCE_AFTER_DATA_DATE" | "UNCLASSIFIED_INVESTMENT" | "UNKNOWN_EXPOSURE" | "STALE_VALUATION" | "MISSING_PROFILE" | "MISSING_POLICY" | "POSSIBLE_DUPLICATE" | "DATA_TRUNCATED";
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  entityId?: string;
  setupHref: string;
  actual?: { unit: "CENTS" | "DAYS" | "COUNT"; value: number };
  threshold?: { unit: "CENTS" | "DAYS" | "COUNT"; value: number };
};

export type CioDataQualitySummary = {
  completenessBps: number;
  completenessPercentage: number;
  latestValuationDate: string | null;
  oldestValuationDate: string | null;
  warnings: CioDataQualityWarning[];
};

export type CioRetirementScenarioName = "BEAR" | "BASE" | "BULL";

export type CioRetirementProjectionPoint = {
  date: string;
  year: number;
  age: number | null;
  nominalCents: number;
  realCents: number;
  annualContributionCents: number;
};

export type CioRetirementScenario = {
  scenario: CioRetirementScenarioName;
  nominalReturnBps: number;
  points: CioRetirementProjectionPoint[];
  fundAtRetirementNominalCents: number;
  fundAtRetirementRealCents: number;
  sustainableMonthlyIncomeNominalCents: number;
  sustainableMonthlyIncomeRealCents: number;
  targetFundNominalCents: number;
  targetFundRealCents: number;
  targetGapOrSurplusNominalCents: number;
  targetGapOrSurplusRealCents: number;
};

export type CioRetirementProjectionAssumptions = {
  asOfDate: string;
  retirementDate: string;
  horizonYears: number;
  currentRetirementAssetsCents: number;
  annualExternalContributionCents: number;
  contributionGrowthRateBps: number;
  inflationRateBps: number;
  bearReturnBps: number;
  baseReturnBps: number;
  bullReturnBps: number;
  targetMonthlySpendingTodayCents: number;
  sustainableWithdrawalRateBps: number;
  contributionTiming: "END_OF_YEAR";
  finalPeriodFractionBps: number;
  horizonRounding: "FULL_YEARS_PLUS_PRORATED_FINAL_PERIOD";
};

export type CioRetirementProjection = {
  assumptions: CioRetirementProjectionAssumptions;
  scenarios: CioRetirementScenario[];
};

export type CioRetirementStatus =
  | { status: "NOT_READY"; missingFields: string[]; projection: null }
  | { status: "READY"; missingFields: []; projection: CioRetirementProjection };

export type CioInvestmentSnapshot = {
  id: string;
  latestValuationDate: string | null;
  investedCents: number | null;
  currentValueCents: number | null;
  valuationAgeDays: number | null;
  isStale: boolean;
  liquidityClass: CioLiquidityClass;
  liquiditySource: "CIO_PROFILE" | "LEGACY_IS_LIQUID_FALLBACK";
  portfolioRole: CioPortfolioRole | null;
  includeInRetirementProjection: boolean;
  classificationStatus: CioClassificationStatus;
};

export type CioSnapshot = {
  asOfDate: string;
  baseCurrency: string;
  totals: {
    bankControlCents: number;
    savingsSubAccountCents: number;
    investmentCurrentValueCents: number;
    financialAssetsCents: number;
    planningPositionAssetsCents: number;
    planningLiabilitiesCents: number;
    planningNetWorthCents: number;
    investableAssetsCents: number;
    retirementIncludedAssetsCents: number;
  };
  liquidity: CioLiquiditySummary;
  allocation: CioAllocationSummary;
  investments: CioInvestmentSnapshot[];
  recurringFlows: CioRecurringFlowSummary;
  annualContributions: {
    derivedExternalAnnualCents: number;
    overrideExternalAnnualCents: number | null;
    usedExternalAnnualCents: number;
    source: "DERIVED" | "OVERRIDE";
    internalReallocationAnnualCents: number;
  };
  dataQuality: CioDataQualitySummary;
  policyExceptions: CioPolicyException[];
  retirement: CioRetirementStatus;
  evidence: CioEvidenceRef[];
};
