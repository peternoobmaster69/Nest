import type { CioExposure, CioExposureDimension, CioLiquidityClass, CioPortfolioRole, CioRiskLevel } from "@/components/cio/types";
import { bpsFromPercentInput, formatCioLabel, percentInputFromBps } from "@/components/cio/cio-format";
import { parseCioDateInput } from "@/components/cio/cio-date-input";

export type ExposureForm = { id: string; dimension: CioExposureDimension; key: string; weight: string };
export type InvestmentForm = {
  liquidityClass: CioLiquidityClass; portfolioRole: CioPortfolioRole; riskLevel: CioRiskLevel;
  includeInRetirementProjection: boolean; lockUntil: string; notes: string; exposures: ExposureForm[]; reviewed: boolean;
};

export function calculateExposureTotals(rows: ExposureForm[]) {
  return rows.reduce<Record<string, number>>((result, row) => {
    result[row.dimension] = (result[row.dimension] ?? 0) + bpsFromPercentInput(row.weight);
    return result;
  }, {});
}

export function prepareInvestmentForm(form: InvestmentForm): { error: string } | { exposures: CioExposure[] } {
  if (form.lockUntil && !parseCioDateInput(form.lockUntil)) return { error: "Choose a valid date for when this investment becomes available." };
  if (form.exposures.length > 100) return { error: "Keep the breakdown to 100 rows or fewer." };

  for (const row of form.exposures) {
    const error = exposureRowError(row);
    if (error) return { error };
  }

  const exposures = form.exposures.map((row) => ({ dimension: row.dimension, key: row.key.trim().toUpperCase(), weightBps: bpsFromPercentInput(row.weight) }));
  const identities = new Set<string>();
  for (const row of exposures) {
    const identity = `${row.dimension}:${row.key}`;
    if (identities.has(identity)) return { error: `${formatCioLabel(row.dimension)} already includes ${formatCioLabel(row.key)}. Combine it into one row or choose a different item.` };
    identities.add(identity);
  }
  for (const [dimension, total] of Object.entries(calculateExposureTotals(form.exposures))) {
    if (total !== 10_000) return { error: `${formatCioLabel(dimension)} adds up to ${percentInputFromBps(total)}%. Adjust those rows so that breakdown totals 100%.` };
  }
  if (!form.reviewed) return { error: "Confirm that you have reviewed this account before saving its classification." };
  return { exposures };
}

function exposureRowError(row: ExposureForm) {
  const key = row.key.trim().toUpperCase();
  if (!key) return `Choose what the ${formatCioLabel(row.dimension).toLowerCase()} row represents.`;
  if (row.dimension === "SECURITY" && !/^[A-Z0-9][A-Z0-9._:-]{0,31}$/.test(key)) {
    return "Use a short ticker-like security code, such as VWRA or CSPX. Use only letters, numbers, dots, underscores, colons, or hyphens.";
  }
  return validateWeight(row.weight, `${formatCioLabel(row.dimension)}: ${formatCioLabel(key)}`);
}

function validateWeight(value: string, label: string) {
  if (!value.trim()) return `Enter the percentage for ${label}.`;
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return `${label} must use a number for its percentage.`;
  const weightBps = bpsFromPercentInput(value);
  if (weightBps <= 0 || percentage > 100) return `${label} must be more than 0% and no more than 100%.`;
  return null;
}
