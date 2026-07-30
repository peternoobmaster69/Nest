import type { CioSnapshot } from "@/lib/domains/cio/types";

export type { CioSnapshot };

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

export type CioProfile = {
  id: string;
  planningScope: CioPlanningScope;
  primaryBirthDate: string | null;
  primaryCurrentAge: number | null;
  primaryAgeAsOfDate: string | null;
  partnerBirthDate: string | null;
  targetRetirementAge: number | null;
  targetRetirementDate: string | null;
  targetMonthlyRetirementSpendingCents: number | null;
  essentialMonthlySpendingCents: number | null;
  minimumImmediateBankCashCents: number | null;
  inflationRateBps: number | null;
  bearReturnBps: number | null;
  baseReturnBps: number | null;
  bullReturnBps: number | null;
  sustainableWithdrawalRateBps: number | null;
  annualExternalContributionOverrideCents: number | null;
  contributionGrowthRateBps: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CioProfilePayload = Omit<CioProfile, "id" | "createdAt" | "updatedAt">;

export type CioPolicyBand = {
  id?: string;
  assetClass: CioAssetClass;
  minimumBps: number;
  targetBps: number;
  maximumBps: number;
};

export type CioGeographyLimit = {
  id?: string;
  geography: CioGeography;
  maximumBps: number;
};

export type CioPolicy = {
  id: string;
  minimumLiquidityReserveCents: number | null;
  minimumLiquidityMonths: number | null;
  maximumAccountConcentrationBps: number | null;
  maximumSingleSecurityConcentrationBps: number | null;
  maximumSatelliteAllocationBps: number | null;
  valuationStaleAfterDays: number;
  allowsOptions: boolean | null;
  allowsMargin: boolean | null;
  allowsLeverage: boolean | null;
  allowsAdditionalIlpTopUps: boolean | null;
  confirmedAt: string | null;
  assetClassBands: CioPolicyBand[];
  geographyLimits: CioGeographyLimit[];
  createdAt: string;
  updatedAt: string;
};

export type CioPolicyPayload = Omit<CioPolicy, "id" | "createdAt" | "updatedAt" | "assetClassBands" | "geographyLimits"> & {
  assetClassBands: Array<Omit<CioPolicyBand, "id">>;
  geographyLimits: Array<Omit<CioGeographyLimit, "id">>;
};

export type CioPlanningPosition = {
  id: string;
  side: CioPositionSide;
  category: string;
  label: string;
  currentValueCents: number;
  asOfDate: string;
  liquidityClass: CioLiquidityClass;
  includeInInvestableAllocation: boolean;
  includeInRetirementProjection: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CioPositionPayload = Omit<CioPlanningPosition, "id" | "createdAt" | "updatedAt">;

export type CioRecurringFlow = {
  id: string;
  type: CioFlowType;
  sourceFinancialAccountId: string | null;
  sourceInvestmentAccountId: string | null;
  destinationInvestmentAccountId: string | null;
  amountCents: number;
  cadence: CioFlowCadence;
  startsOn: string;
  endsOn: string | null;
  includeInRetirementProjection: boolean;
  label: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CioFlowPayload = Omit<CioRecurringFlow, "id" | "createdAt" | "updatedAt">;

export type CioInvestmentProfile = {
  id: string;
  investmentAccountId: string;
  liquidityClass: CioLiquidityClass;
  portfolioRole: CioPortfolioRole;
  riskLevel: CioRiskLevel;
  includeInRetirementProjection: boolean;
  lockUntil: string | null;
  classificationStatus: CioClassificationStatus;
  classificationSource: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CioInvestmentProfilePayload = Omit<CioInvestmentProfile, "id" | "investmentAccountId" | "createdAt" | "updatedAt">;

export type CioExposure = {
  id?: string;
  investmentAccountId?: string;
  dimension: CioExposureDimension;
  key: string;
  weightBps: number;
  createdAt?: string;
  updatedAt?: string;
};

export type InvestmentOption = {
  id: string;
  displayName?: string | null;
  institutionName: string;
  productName: string;
};

export type CioSetupSection = "profile" | "policy" | "positions" | "flows" | "investments";
