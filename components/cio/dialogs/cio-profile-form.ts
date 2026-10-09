import type { CioPlanningScope, CioProfile } from "@/components/cio/types";
import { moneyInputFromCents, percentInputFromBps, toDateInput } from "@/components/cio/cio-format";
import { localDateInput, parseCioDateInput } from "@/components/cio/cio-date-input";

export type ProfileForm = {
  planningScope: CioPlanningScope;
  primaryBirthDate: string;
  primaryCurrentAge: string;
  primaryAgeAsOfDate: string;
  partnerBirthDate: string;
  targetRetirementAge: string;
  targetRetirementDate: string;
  retirementSpending: string;
  essentialSpending: string;
  minimumCash: string;
  inflation: string;
  bearReturn: string;
  baseReturn: string;
  bullReturn: string;
  withdrawalRate: string;
  contributionOverride: string;
  contributionGrowth: string;
};

export type ProfileFormErrors = Partial<Record<keyof ProfileForm, string>>;

export const EMPTY_FORM: ProfileForm = {
  planningScope: "INDIVIDUAL",
  primaryBirthDate: "",
  primaryCurrentAge: "",
  primaryAgeAsOfDate: "",
  partnerBirthDate: "",
  targetRetirementAge: "",
  targetRetirementDate: "",
  retirementSpending: "",
  essentialSpending: "",
  minimumCash: "",
  inflation: "",
  bearReturn: "",
  baseReturn: "",
  bullReturn: "",
  withdrawalRate: "",
  contributionOverride: "",
  contributionGrowth: "",
};

export const MAX_MONEY_INPUT = 21_474_836.47;

export function ageFromBirthDate(birthDate: string, today = localDateInput()) {
  const birth = parseCioDateInput(birthDate);
  const current = parseCioDateInput(today);
  if (!birth || !current || birthDate > today) return null;
  let age = current.year - birth.year;
  if (current.month < birth.month || (current.month === birth.month && current.day < birth.day)) age -= 1;
  return age;
}

export function validateProfileForm(form: ProfileForm, today: string): ProfileFormErrors {
  const errors = profileTimingErrors(form, today);

  for (const [field, label] of [
    ["retirementSpending", "Retirement spending"],
    ["essentialSpending", "Essential spending"],
    ["minimumCash", "Minimum bank cash"],
    ["contributionOverride", "Contribution override"],
  ] as const) {
    const error = numberError(form[field], label, { min: 0, max: MAX_MONEY_INPUT });
    if (error) errors[field] = error;
  }
  for (const [field, label, min, max] of [
    ["inflation", "Inflation rate", -99.99, 1000],
    ["contributionGrowth", "Contribution growth", -100, 1000],
    ["bearReturn", "Bear return", -100, 1000],
    ["baseReturn", "Base return", -100, 1000],
    ["bullReturn", "Bull return", -100, 1000],
    ["withdrawalRate", "Withdrawal rate", 0.01, 100],
  ] as const) {
    const error = numberError(form[field], label, { min, max });
    if (error) errors[field] = error;
  }

  const bear = optionalFiniteNumber(form.bearReturn);
  const base = optionalFiniteNumber(form.baseReturn);
  const bull = optionalFiniteNumber(form.bullReturn);
  if (bear !== null && base !== null && bear > base) errors.bearReturn = "Bear return must be less than or equal to base return.";
  if (base !== null && bull !== null && base > bull) errors.bullReturn = "Bull return must be greater than or equal to base return.";
  return errors;
}

function profileTimingErrors(form: ProfileForm, today: string): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  const primaryDateError = dateNotAfter(form.primaryBirthDate, today, "date of birth");
  const partnerDateError = dateNotAfter(form.partnerBirthDate, today, "partner's date of birth");
  if (primaryDateError) errors.primaryBirthDate = primaryDateError;
  if (partnerDateError) errors.partnerBirthDate = partnerDateError;

  if (!form.primaryBirthDate) Object.assign(errors, manualAgeErrors(form, today));

  const retirementAgeError = numberError(form.targetRetirementAge, "Retirement age", { min: 18, max: 120, integer: true });
  if (retirementAgeError) errors.targetRetirementAge = retirementAgeError;
  if (form.targetRetirementDate && !parseCioDateInput(form.targetRetirementDate)) errors.targetRetirementDate = "Enter a valid retirement date.";
  if (form.targetRetirementAge && form.targetRetirementDate) errors.targetRetirementDate = "Choose a retirement age or a retirement date, not both.";

  return errors;
}

function manualAgeErrors(form: ProfileForm, today: string): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  const ageError = numberError(form.primaryCurrentAge, "Current age", { min: 0, max: 120, integer: true });
  if (ageError) errors.primaryCurrentAge = ageError;
  const ageDateError = dateNotAfter(form.primaryAgeAsOfDate, today, "age date");
  if (ageDateError) errors.primaryAgeAsOfDate = ageDateError;
  if (form.primaryCurrentAge && !form.primaryAgeAsOfDate) errors.primaryAgeAsOfDate = "Choose the date when this age was accurate.";
  if (!form.primaryCurrentAge && form.primaryAgeAsOfDate) errors.primaryCurrentAge = "Enter the age that was accurate on this date.";
  return errors;
}

export function formFromProfile(profile: CioProfile): ProfileForm {
  const hasBirthDate = Boolean(profile.primaryBirthDate);
  return {
    planningScope: profile.planningScope ?? (profile.partnerBirthDate ? "HOUSEHOLD" : "INDIVIDUAL"),
    primaryBirthDate: toDateInput(profile.primaryBirthDate),
    primaryCurrentAge: hasBirthDate ? "" : valueOrBlank(profile.primaryCurrentAge),
    primaryAgeAsOfDate: hasBirthDate ? "" : toDateInput(profile.primaryAgeAsOfDate),
    partnerBirthDate: toDateInput(profile.partnerBirthDate),
    targetRetirementAge: valueOrBlank(profile.targetRetirementAge),
    targetRetirementDate: toDateInput(profile.targetRetirementDate),
    retirementSpending: moneyInputFromCents(profile.targetMonthlyRetirementSpendingCents),
    essentialSpending: moneyInputFromCents(profile.essentialMonthlySpendingCents),
    minimumCash: moneyInputFromCents(profile.minimumImmediateBankCashCents),
    inflation: percentInputFromBps(profile.inflationRateBps),
    bearReturn: percentInputFromBps(profile.bearReturnBps),
    baseReturn: percentInputFromBps(profile.baseReturnBps),
    bullReturn: percentInputFromBps(profile.bullReturnBps),
    withdrawalRate: percentInputFromBps(profile.sustainableWithdrawalRateBps),
    contributionOverride: moneyInputFromCents(profile.annualExternalContributionOverrideCents),
    contributionGrowth: percentInputFromBps(profile.contributionGrowthRateBps),
  };
}

function dateNotAfter(value: string, maximum: string, label: string) {
  if (!value) return null;
  if (!parseCioDateInput(value)) return `Enter a valid ${label}.`;
  return value > maximum ? `${label.charAt(0).toUpperCase()}${label.slice(1)} cannot be in the future.` : null;
}

function numberError(value: string, label: string, options: { min: number; max: number; integer?: boolean }) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `Enter ${label.toLowerCase()} as a number.`;
  if (options.integer && !Number.isInteger(parsed)) return `${label} must be a whole number.`;
  if (parsed < options.min || parsed > options.max) return `${label} must be between ${options.min} and ${options.max}.`;
  return null;
}

function optionalFiniteNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueOrBlank(value: number | null) { return value == null ? "" : String(value); }
export function numberOrNull(value: string) { return value.trim() ? Number(value) : null; }
