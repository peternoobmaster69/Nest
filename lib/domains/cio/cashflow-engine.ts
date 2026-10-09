export const RECURRING_FLOW_ANNUAL_MULTIPLIERS = {
  WEEKLY: 52,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUAL: 1,
} as const;

export const RUNWAY_MONTH_SCALE = 10_000;

const BIGINT_ZERO = BigInt(0);

export type RecurringFlowCadence = keyof typeof RECURRING_FLOW_ANNUAL_MULTIPLIERS;
export type RecurringFlowType =
  | "EXTERNAL_CONTRIBUTION"
  | "INTERNAL_REALLOCATION"
  | "EXTERNAL_WITHDRAWAL";
export type CashflowDateInput = string | Date;

export interface RecurringFlow {
  id: string;
  type: RecurringFlowType;
  amountCents: number;
  cadence: RecurringFlowCadence;
  startDate?: CashflowDateInput | null;
  endDate?: CashflowDateInput | null;
  includeInRetirementProjection: boolean;
  label?: string | null;
  sourceAccountId?: string | null;
  sourceInvestmentId?: string | null;
  destinationInvestmentId?: string | null;
}

export interface AnnualizedFlowTotals {
  flowCount: number;
  externalContributionCents: number;
  externalWithdrawalCents: number;
  netExternalContributionCents: number;
  internalReallocationCents: number;
}

export interface RecurringFlowBreakdown {
  id: string;
  label: string | null;
  type: RecurringFlowType;
  cadence: RecurringFlowCadence;
  active: boolean;
  retirementEligible: boolean;
  annualizedCents: number;
  newWealthImpactCents: number;
  sourceAccountId: string | null;
  sourceInvestmentId: string | null;
  destinationInvestmentId: string | null;
}

export interface RecurringFlowSummary {
  asOfDate: string;
  active: AnnualizedFlowTotals;
  retirementEligible: AnnualizedFlowTotals;
  sourceBreakdown: RecurringFlowBreakdown[];
  annualExternalContributionCents: number;
  annualGrossExternalContributionCents: number;
  annualExternalWithdrawalCents: number;
  annualInternalReallocationCents: number;
  retirementAnnualExternalContributionCents: number;
}

export interface RecurringFlowSummaryOptions {
  asOfDate: CashflowDateInput;
}

export interface EmergencyRunway {
  availableLiquidityCents: number;
  essentialMonthlyExpenseCents: number | null;
  configured: boolean;
  wholeMonths: number | null;
  remainderCents: number | null;
  runwayMonthsBps: number | null;
}

export type CashflowValidationCode =
  | "INVALID_AMOUNT"
  | "INVALID_CADENCE"
  | "INVALID_DATE"
  | "INVALID_DATE_RANGE"
  | "INVALID_FLOW"
  | "RESULT_OUT_OF_RANGE";

export class CashflowValidationError extends Error {
  readonly code: CashflowValidationCode;
  readonly field?: string;

  constructor(code: CashflowValidationCode, message: string, field?: string) {
    super(message);
    this.name = "CashflowValidationError";
    this.code = code;
    this.field = field;
  }
}

function assertSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) {
    throw new CashflowValidationError(
      "INVALID_AMOUNT",
      `${field} must be an integer within JavaScript's safe integer range.`,
      field,
    );
  }
}

function toSafeNumber(value: bigint, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new CashflowValidationError(
      "RESULT_OUT_OF_RANGE",
      `${field} is outside JavaScript's safe integer range.`,
      field,
    );
  }
  return result;
}

function parseDate(value: CashflowDateInput | null | undefined, field: string) {
  if (value === null || value === undefined) {
    throw new CashflowValidationError("INVALID_DATE", `${field} is required.`, field);
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new CashflowValidationError("INVALID_DATE", `${field} must be a valid date.`, field);
  }
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    result.toISOString().slice(0, 10) !== value
  ) {
    throw new CashflowValidationError(
      "INVALID_DATE",
      `${field} must be a valid calendar date.`,
      field,
    );
  }
  return result;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeAsOfInput(input: CashflowDateInput | RecurringFlowSummaryOptions) {
  return input !== null && typeof input === "object" && !(input instanceof Date) && "asOfDate" in input
    ? input.asOfDate
    : input;
}

function isSupportedCadence(value: string): value is RecurringFlowCadence {
  return Object.hasOwn(RECURRING_FLOW_ANNUAL_MULTIPLIERS, value);
}

function validateFlow(flow: RecurringFlow, index?: number) {
  const prefix = index === undefined ? "flow" : `flows[${index}]`;
  if (typeof flow.id !== "string" || flow.id.length === 0 || flow.id.trim() !== flow.id) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix}.id must be a non-empty, trimmed string.`,
      `${prefix}.id`,
    );
  }
  if (
    flow.type !== "EXTERNAL_CONTRIBUTION" &&
    flow.type !== "INTERNAL_REALLOCATION" &&
    flow.type !== "EXTERNAL_WITHDRAWAL"
  ) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix}.type is not supported.`,
      `${prefix}.type`,
    );
  }
  assertSafeInteger(flow.amountCents, `${prefix}.amountCents`);
  if (flow.amountCents <= 0) {
    throw new CashflowValidationError(
      "INVALID_AMOUNT",
      `${prefix}.amountCents must be greater than zero.`,
      `${prefix}.amountCents`,
    );
  }
  if (!isSupportedCadence(flow.cadence)) {
    throw new CashflowValidationError(
      "INVALID_CADENCE",
      `${prefix}.cadence is not supported.`,
      `${prefix}.cadence`,
    );
  }
  if (typeof flow.includeInRetirementProjection !== "boolean") {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix}.includeInRetirementProjection must be a boolean.`,
      `${prefix}.includeInRetirementProjection`,
    );
  }
  validateFlowEndpoints(flow, prefix);
  const start = flow.startDate == null ? null : parseDate(flow.startDate, `${prefix}.startDate`);
  const end = flow.endDate == null ? null : parseDate(flow.endDate, `${prefix}.endDate`);
  if (start && end && start.getTime() > end.getTime()) {
    throw new CashflowValidationError(
      "INVALID_DATE_RANGE",
      `${prefix}.startDate cannot be after endDate.`,
      prefix,
    );
  }
}

function validateFlowEndpoints(flow: RecurringFlow, prefix: string) {
  if (flow.sourceAccountId && flow.sourceInvestmentId) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix} can identify only one existing source.`,
      `${prefix}.sourceInvestmentId`,
    );
  }
  if (flow.sourceInvestmentId && flow.sourceInvestmentId === flow.destinationInvestmentId) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix} cannot reallocate an investment to itself.`,
      `${prefix}.destinationInvestmentId`,
    );
  }
  const hasSource = Boolean(flow.sourceAccountId || flow.sourceInvestmentId);
  const hasDestination = Boolean(flow.destinationInvestmentId);
  if (flow.type === "EXTERNAL_CONTRIBUTION" && hasSource) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix} sources an existing Nest holding and cannot be counted as a new external contribution.`,
      `${prefix}.type`,
    );
  }
  if (flow.type === "INTERNAL_REALLOCATION" && (!hasSource || !hasDestination)) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix} must identify one existing source and a destination investment.`,
      `${prefix}.type`,
    );
  }
  if (flow.type !== "INTERNAL_REALLOCATION" && hasSource && hasDestination) {
    throw new CashflowValidationError(
      "INVALID_FLOW",
      `${prefix} moves money between existing Nest holdings and must be an internal reallocation.`,
      `${prefix}.type`,
    );
  }

}

export function annualizeRecurringAmount(amountCents: number, cadence: RecurringFlowCadence) {
  assertSafeInteger(amountCents, "amountCents");
  if (amountCents < 0) {
    throw new CashflowValidationError(
      "INVALID_AMOUNT",
      "amountCents cannot be negative; use the flow type to express direction.",
      "amountCents",
    );
  }
  if (!isSupportedCadence(cadence)) {
    throw new CashflowValidationError(
      "INVALID_CADENCE",
      "cadence is not supported.",
      "cadence",
    );
  }
  return toSafeNumber(
    BigInt(amountCents) * BigInt(RECURRING_FLOW_ANNUAL_MULTIPLIERS[cadence]),
    "annualizedCents",
  );
}

export function annualizeRecurringFlow(flow: RecurringFlow) {
  validateFlow(flow);
  return annualizeRecurringAmount(flow.amountCents, flow.cadence);
}

export function isRecurringFlowActiveAsOf(flow: RecurringFlow, asOfDate: CashflowDateInput) {
  validateFlow(flow);
  const asOf = parseDate(asOfDate, "asOfDate").getTime();
  const startsOnOrBefore = flow.startDate == null || parseDate(flow.startDate, "flow.startDate").getTime() <= asOf;
  const endsOnOrAfter = flow.endDate == null || parseDate(flow.endDate, "flow.endDate").getTime() >= asOf;
  return startsOnOrBefore && endsOnOrAfter;
}

interface MutableFlowTotals {
  flowCount: number;
  externalContributionCents: bigint;
  externalWithdrawalCents: bigint;
  internalReallocationCents: bigint;
}

function emptyFlowTotals(): MutableFlowTotals {
  return {
    flowCount: 0,
    externalContributionCents: BIGINT_ZERO,
    externalWithdrawalCents: BIGINT_ZERO,
    internalReallocationCents: BIGINT_ZERO,
  };
}

function addToTotals(totals: MutableFlowTotals, type: RecurringFlowType, amountCents: number) {
  totals.flowCount += 1;
  if (type === "EXTERNAL_CONTRIBUTION") {
    totals.externalContributionCents += BigInt(amountCents);
  } else if (type === "EXTERNAL_WITHDRAWAL") {
    totals.externalWithdrawalCents += BigInt(amountCents);
  } else {
    totals.internalReallocationCents += BigInt(amountCents);
  }
}

function finalizeTotals(totals: MutableFlowTotals, field: string): AnnualizedFlowTotals {
  const netExternalContributionCents =
    totals.externalContributionCents - totals.externalWithdrawalCents;
  return {
    flowCount: totals.flowCount,
    externalContributionCents: toSafeNumber(
      totals.externalContributionCents,
      `${field}.externalContributionCents`,
    ),
    externalWithdrawalCents: toSafeNumber(
      totals.externalWithdrawalCents,
      `${field}.externalWithdrawalCents`,
    ),
    netExternalContributionCents: toSafeNumber(
      netExternalContributionCents,
      `${field}.netExternalContributionCents`,
    ),
    internalReallocationCents: toSafeNumber(
      totals.internalReallocationCents,
      `${field}.internalReallocationCents`,
    ),
  };
}

function newWealthImpact(type: RecurringFlowType, annualizedCents: number) {
  if (type === "EXTERNAL_CONTRIBUTION") return annualizedCents;
  return type === "EXTERNAL_WITHDRAWAL" ? -annualizedCents : 0;
}

export function summarizeRecurringFlows(
  flows: readonly RecurringFlow[],
  asOfInput: CashflowDateInput | RecurringFlowSummaryOptions,
): RecurringFlowSummary {
  const asOf = parseDate(normalizeAsOfInput(asOfInput), "asOfDate");
  const activeTotals = emptyFlowTotals();
  const retirementTotals = emptyFlowTotals();
  const ids = new Set<string>();
  const sourceBreakdown: RecurringFlowBreakdown[] = [];

  for (const [index, flow] of flows.entries()) {
    validateFlow(flow, index);
    if (ids.has(flow.id)) {
      throw new CashflowValidationError(
        "INVALID_FLOW",
        `Flow ${flow.id} appears more than once.`,
        `flows[${index}].id`,
      );
    }
    ids.add(flow.id);

    const annualizedCents = annualizeRecurringAmount(flow.amountCents, flow.cadence);
    const active = isRecurringFlowActiveAsOf(flow, asOf);
    const newWealthImpactCents = newWealthImpact(flow.type, annualizedCents);
    if (active) {
      addToTotals(activeTotals, flow.type, annualizedCents);
      if (flow.includeInRetirementProjection) {
        addToTotals(retirementTotals, flow.type, annualizedCents);
      }
    }

    sourceBreakdown.push({
      id: flow.id,
      label: flow.label ?? null,
      type: flow.type,
      cadence: flow.cadence,
      active,
      retirementEligible: active && flow.includeInRetirementProjection,
      annualizedCents,
      newWealthImpactCents,
      sourceAccountId: flow.sourceAccountId ?? null,
      sourceInvestmentId: flow.sourceInvestmentId ?? null,
      destinationInvestmentId: flow.destinationInvestmentId ?? null,
    });
  }

  sourceBreakdown.sort((left, right) => Number(left.id > right.id) - Number(left.id < right.id));
  const active = finalizeTotals(activeTotals, "active");
  const retirementEligible = finalizeTotals(retirementTotals, "retirementEligible");
  return {
    asOfDate: toIsoDate(asOf),
    active,
    retirementEligible,
    sourceBreakdown,
    annualExternalContributionCents: active.netExternalContributionCents,
    annualGrossExternalContributionCents: active.externalContributionCents,
    annualExternalWithdrawalCents: active.externalWithdrawalCents,
    annualInternalReallocationCents: active.internalReallocationCents,
    retirementAnnualExternalContributionCents:
      retirementEligible.netExternalContributionCents,
  };
}

/**
 * Returns runway in ten-thousandths of a month. A null expense means the
 * assumption is not configured. A configured zero expense has no finite
 * runway calculation, so its expense is preserved and runway stays null.
 */
export function calculateEmergencyRunway(
  availableLiquidityCents: number,
  essentialMonthlyExpenseCents: number | null | undefined,
): EmergencyRunway {
  assertSafeInteger(availableLiquidityCents, "availableLiquidityCents");
  if (availableLiquidityCents < 0) {
    throw new CashflowValidationError(
      "INVALID_AMOUNT",
      "availableLiquidityCents cannot be negative.",
      "availableLiquidityCents",
    );
  }
  if (essentialMonthlyExpenseCents == null) {
    return {
      availableLiquidityCents,
      essentialMonthlyExpenseCents: null,
      configured: false,
      wholeMonths: null,
      remainderCents: null,
      runwayMonthsBps: null,
    };
  }

  assertSafeInteger(essentialMonthlyExpenseCents, "essentialMonthlyExpenseCents");
  if (essentialMonthlyExpenseCents < 0) {
    throw new CashflowValidationError(
      "INVALID_AMOUNT",
      "essentialMonthlyExpenseCents cannot be negative.",
      "essentialMonthlyExpenseCents",
    );
  }
  if (essentialMonthlyExpenseCents === 0) {
    return {
      availableLiquidityCents,
      essentialMonthlyExpenseCents: 0,
      configured: true,
      wholeMonths: null,
      remainderCents: null,
      runwayMonthsBps: null,
    };
  }
  const available = BigInt(availableLiquidityCents);
  const expense = BigInt(essentialMonthlyExpenseCents);
  return {
    availableLiquidityCents,
    essentialMonthlyExpenseCents,
    configured: true,
    wholeMonths: toSafeNumber(available / expense, "wholeMonths"),
    remainderCents: toSafeNumber(available % expense, "remainderCents"),
    runwayMonthsBps: toSafeNumber(
      (available * BigInt(RUNWAY_MONTH_SCALE)) / expense,
      "runwayMonthsBps",
    ),
  };
}
