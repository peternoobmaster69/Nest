import type {
  CioAssetClass,
  CioGeography,
  CioLiquidityClass,
  CioPortfolioRole,
  CioRiskLevel,
  CioClassificationStatus,
  CioExposureDimension,
  CioPositionSide,
  CioFlowType,
  CioFlowCadence,
  CioPlanningScope,
} from "@/lib/domains/cio/types";

export type {
  CioSnapshot,
  CioAssetClass,
  CioGeography,
  CioLiquidityClass,
  CioPortfolioRole,
  CioRiskLevel,
  CioClassificationStatus,
  CioExposureDimension,
  CioPositionSide,
  CioFlowType,
  CioFlowCadence,
  CioPlanningScope,
} from "@/lib/domains/cio/types";
export {
  CIO_ASSET_CLASSES,
  CIO_GEOGRAPHIES,
  CIO_LIQUIDITY_CLASSES,
  CIO_PORTFOLIO_ROLES,
  CIO_RISK_LEVELS,
  CIO_CLASSIFICATION_STATUSES,
  CIO_EXPOSURE_DIMENSIONS,
  CIO_POSITION_SIDES,
  CIO_FLOW_TYPES,
  CIO_FLOW_CADENCES,
  CIO_PLANNING_SCOPES,
} from "@/lib/domains/cio/types";
export type {
  CioStrategyReportModel,
  CioStrategyReportSummary,
} from "@/lib/domains/cio/report-types";
export type { CioStrategyRecommendation } from "@/lib/domains/cio/strategy-recommendations";

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
