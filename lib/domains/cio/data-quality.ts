import type { CioDataQualitySummary, CioDataQualityWarning } from "./types";

const DAY_MS = 86_400_000;

export type CioQualityInvestment = {
  id: string;
  latestValuationDate: Date | null;
  currentValueCents: number | null;
  hasConfirmedProfile: boolean;
  hasAssetClassExposure: boolean;
  hasGeographyExposure: boolean;
};

export function differenceInUtcDays(later: Date, earlier: Date) {
  const laterDay = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const earlierDay = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.max(0, Math.floor((laterDay - earlierDay) / DAY_MS));
}

export function assessCioDataQuality(params: {
  asOfDate: Date;
  investments: readonly CioQualityInvestment[];
  hasHouseholdProfile: boolean;
  missingHouseholdFields?: readonly string[];
  hasConfirmedPolicy: boolean;
  staleAfterDays: number;
  bankControlCount?: number;
  bankControlsAfterAsOfCount?: number;
  savingsSubAccountCount?: number;
  savingsSubAccountsAfterAsOfCount?: number;
  duplicatePlanningPositionIds?: readonly string[];
  truncatedSections?: readonly string[];
}): CioDataQualitySummary {
  const warnings: CioDataQualityWarning[] = [];
  let earned = Number(params.hasHouseholdProfile) + Number(params.hasConfirmedPolicy);
  let possible = 2;
  const valuationDates: Date[] = [];

  const bankControlCount = params.bankControlCount ?? 0;
  const bankControlsAfterAsOfCount = params.bankControlsAfterAsOfCount ?? 0;
  possible += bankControlCount;
  earned += Math.max(0, bankControlCount - bankControlsAfterAsOfCount);
  if (bankControlsAfterAsOfCount > 0) {
    warnings.push({
      code: "BANK_BALANCE_AFTER_DATA_DATE",
      severity: "CRITICAL",
      message: `${bankControlsAfterAsOfCount} current bank control balance${bankControlsAfterAsOfCount === 1 ? " was" : "s were"} updated after the requested data date and is excluded because Nest has no historical bank-balance series.`,
      setupHref: "/",
      actual: { unit: "COUNT", value: bankControlsAfterAsOfCount },
      threshold: { unit: "COUNT", value: 0 },
    });
  }

  const savingsSubAccountCount = params.savingsSubAccountCount ?? 0;
  const savingsSubAccountsAfterAsOfCount = params.savingsSubAccountsAfterAsOfCount ?? 0;
  possible += savingsSubAccountCount;
  earned += Math.max(0, savingsSubAccountCount - savingsSubAccountsAfterAsOfCount);
  if (savingsSubAccountsAfterAsOfCount > 0) {
    warnings.push({
      code: "SAVINGS_BALANCE_AFTER_DATA_DATE",
      severity: "CRITICAL",
      message: `${savingsSubAccountsAfterAsOfCount} current savings sub-account balance${savingsSubAccountsAfterAsOfCount === 1 ? " was" : "s were"} updated after the requested data date and is excluded because Nest has no historical sub-account balance series.`,
      setupHref: "/transactions",
      actual: { unit: "COUNT", value: savingsSubAccountsAfterAsOfCount },
      threshold: { unit: "COUNT", value: 0 },
    });
  }

  if (!params.hasHouseholdProfile) {
    const suffix = params.missingHouseholdFields?.length
      ? ` Missing: ${params.missingHouseholdFields.join(", ")}.`
      : "";
    warnings.push({ code: "MISSING_PROFILE", severity: "WARNING", message: `Household retirement and liquidity assumptions are incomplete.${suffix}`, setupHref: "/cio?setup=profile" });
  }
  if (!params.hasConfirmedPolicy) {
    warnings.push({ code: "MISSING_POLICY", severity: "WARNING", message: "Investment policy constraints have not been confirmed.", setupHref: "/cio?setup=policy" });
  }

  for (const investment of params.investments) {
    possible += 4;
    if (investment.latestValuationDate) {
      valuationDates.push(investment.latestValuationDate);
      const ageDays = differenceInUtcDays(params.asOfDate, investment.latestValuationDate);
      if (investment.currentValueCents !== null && investment.currentValueCents < 0) {
        warnings.push({
          code: "NEGATIVE_VALUATION",
          severity: "CRITICAL",
          message: "An investment has a negative current valuation. It remains in the financial-asset total but is excluded from allocation, liquidity, and retirement assets until reviewed.",
          entityId: investment.id,
          setupHref: `/investments?accountId=${encodeURIComponent(investment.id)}`,
          actual: { unit: "CENTS", value: investment.currentValueCents },
          threshold: { unit: "CENTS", value: 0 },
        });
      } else {
        earned += 1;
      }
      if (ageDays > params.staleAfterDays) {
        warnings.push({
          code: "STALE_VALUATION",
          severity: "WARNING",
          message: `An investment valuation is ${ageDays} days old; the configured freshness limit is ${params.staleAfterDays} days.`,
          entityId: investment.id,
          setupHref: `/investments?accountId=${encodeURIComponent(investment.id)}`,
          actual: { unit: "DAYS", value: ageDays },
          threshold: { unit: "DAYS", value: params.staleAfterDays },
        });
      }
    } else {
      warnings.push({
        code: "MISSING_VALUATION",
        severity: "CRITICAL",
        message: "An investment has no valuation on or before the data date and is excluded from money totals.",
        entityId: investment.id,
        setupHref: `/investments?accountId=${encodeURIComponent(investment.id)}`,
      });
    }
    if (investment.hasConfirmedProfile) earned += 1;
    else warnings.push({
      code: "UNCLASSIFIED_INVESTMENT",
      severity: "WARNING",
      message: "An investment does not have a user-confirmed CIO classification.",
      entityId: investment.id,
      setupHref: `/cio?setup=investment&investmentId=${encodeURIComponent(investment.id)}`,
    });
    if (investment.hasAssetClassExposure) earned += 1;
    else warnings.push({
      code: "UNKNOWN_EXPOSURE",
      severity: "WARNING",
      message: "An investment does not have a complete known asset-class exposure and remains wholly or partly under UNKNOWN.",
      entityId: investment.id,
      setupHref: `/cio?setup=exposures&investmentId=${encodeURIComponent(investment.id)}`,
    });
    if (investment.hasGeographyExposure) earned += 1;
    else warnings.push({
      code: "UNKNOWN_EXPOSURE",
      severity: "WARNING",
      message: "An investment does not have a complete known geography exposure and remains wholly or partly under UNKNOWN.",
      entityId: investment.id,
      setupHref: `/cio?setup=exposures&investmentId=${encodeURIComponent(investment.id)}`,
    });
  }

  for (const id of params.duplicatePlanningPositionIds ?? []) {
    warnings.push({
      code: "POSSIBLE_DUPLICATE",
      severity: "WARNING",
      message: "A planning position may duplicate an existing Nest investment; review both records before relying on planning net worth.",
      entityId: id,
      setupHref: `/cio?setup=position&id=${encodeURIComponent(id)}`,
    });
  }
  for (const section of params.truncatedSections ?? []) {
    possible += 1;
    warnings.push({
      code: "DATA_TRUNCATED",
      severity: "CRITICAL",
      message: `The bounded ${section} read exceeded its supported limit; totals are incomplete.`,
      setupHref: "/cio?setup=data-quality",
    });
  }

  const completenessBps = possible === 0 ? 0 : Math.round((earned * 10_000) / possible);
  const orderedDates = valuationDates.sort((left, right) => left.getTime() - right.getTime());
  return {
    completenessBps,
    completenessPercentage: completenessBps / 100,
    latestValuationDate: orderedDates.at(-1)?.toISOString().slice(0, 10) ?? null,
    oldestValuationDate: orderedDates[0]?.toISOString().slice(0, 10) ?? null,
    warnings,
  };
}
