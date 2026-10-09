export const BASIS_POINTS_SCALE = 10_000;
export const UNKNOWN_EXPOSURE_KEY = "UNKNOWN";

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const LIQUIDITY_CLASSES = new Set<LiquidityClass>([
  "IMMEDIATE",
  "LIQUID",
  "RESTRICTED",
  "LOCKED",
  "UNKNOWN",
]);

export type ExposureDimension = "ASSET_CLASS" | "GEOGRAPHY" | "SECURITY";

export type LiquidityClass = "IMMEDIATE" | "LIQUID" | "RESTRICTED" | "LOCKED" | "UNKNOWN";

export interface WeightedExposureSlice {
  key: string;
  weightBps: number;
}

export interface BigIntAllocatedExposureSlice extends WeightedExposureSlice {
  valueCents: bigint;
}

export interface AllocatedExposureSlice extends WeightedExposureSlice {
  valueCents: number;
}

export interface AllocationSource {
  id: string;
  valueCents: number;
  assetClassExposures?: readonly WeightedExposureSlice[] | null;
  geographyExposures?: readonly WeightedExposureSlice[] | null;
  securityExposures?: readonly WeightedExposureSlice[] | null;
}

export interface SourceAllocation {
  sourceId: string;
  key: string;
  sourceWeightBps: number;
  valueCents: number;
}

export interface AllocationBucket {
  key: string;
  valueCents: number;
  allocationBps: number;
}

export interface DimensionAllocation {
  dimension: ExposureDimension;
  totalValueCents: number;
  unknownValueCents: number;
  buckets: AllocationBucket[];
  sourceAllocations: SourceAllocation[];
}

export interface PortfolioAllocation {
  totalValueCents: number;
  assetClass: DimensionAllocation;
  geography: DimensionAllocation;
  security: DimensionAllocation;
}

export interface LiquiditySource {
  id: string;
  valueCents: number;
  liquidityClass?: LiquidityClass | null;
}

export interface LiquidityTotals {
  totalValueCents: number;
  immediateValueCents: number;
  liquidValueCents: number;
  restrictedValueCents: number;
  lockedValueCents: number;
  unknownValueCents: number;
  accessibleValueCents: number;
}

export type AllocationValidationCode =
  | "INVALID_CENTS"
  | "INVALID_SOURCE"
  | "INVALID_WEIGHT"
  | "DUPLICATE_KEY"
  | "DUPLICATE_SOURCE"
  | "WEIGHTS_NOT_10000_BPS"
  | "RESULT_OUT_OF_RANGE";

export class AllocationValidationError extends Error {
  readonly code: AllocationValidationCode;
  readonly field?: string;

  constructor(code: AllocationValidationCode, message: string, field?: string) {
    super(message);
    this.name = "AllocationValidationError";
    this.code = code;
    this.field = field;
  }
}

type RemainderRow = { key: string; remainder: bigint };

function compareRemainders(left: RemainderRow, right: RemainderRow) {
  if (left.remainder === right.remainder) return compareStableKeys(left.key, right.key);
  return left.remainder > right.remainder ? -1 : 1;
}

function compareStableKeys(left: string, right: string) {
  return Number(left > right) - Number(left < right);
}

function assertSafeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value)) {
    throw new AllocationValidationError(
      "INVALID_CENTS",
      `${field} must be an integer within JavaScript's safe integer range.`,
      field,
    );
  }
}

function toSafeNumber(value: bigint, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new AllocationValidationError(
      "RESULT_OUT_OF_RANGE",
      `${field} is outside JavaScript's safe integer range.`,
      field,
    );
  }
  return result;
}

function validateSlices(slices: readonly WeightedExposureSlice[]) {
  if (slices.length === 0) {
    throw new AllocationValidationError(
      "WEIGHTS_NOT_10000_BPS",
      `Exposure weights must total exactly ${BASIS_POINTS_SCALE} basis points.`,
      "slices",
    );
  }

  const keys = new Set<string>();
  let totalWeightBps = 0;
  for (const [index, slice] of slices.entries()) {
    if (typeof slice.key !== "string" || slice.key.length === 0 || slice.key.trim() !== slice.key) {
      throw new AllocationValidationError(
        "INVALID_WEIGHT",
        `slices[${index}].key must be a non-empty, trimmed string.`,
        `slices[${index}].key`,
      );
    }
    if (keys.has(slice.key)) {
      throw new AllocationValidationError(
        "DUPLICATE_KEY",
        `Exposure key ${slice.key} appears more than once.`,
        `slices[${index}].key`,
      );
    }
    keys.add(slice.key);

    if (!Number.isInteger(slice.weightBps) || slice.weightBps <= 0 || slice.weightBps > BASIS_POINTS_SCALE) {
      throw new AllocationValidationError(
        "INVALID_WEIGHT",
        `slices[${index}].weightBps must be an integer from 1 to ${BASIS_POINTS_SCALE}.`,
        `slices[${index}].weightBps`,
      );
    }
    totalWeightBps += slice.weightBps;
  }

  if (totalWeightBps !== BASIS_POINTS_SCALE) {
    throw new AllocationValidationError(
      "WEIGHTS_NOT_10000_BPS",
      `Exposure weights total ${totalWeightBps}; expected exactly ${BASIS_POINTS_SCALE} basis points.`,
      "slices",
    );
  }
}

/**
 * Allocates signed integer cents with the largest-remainder method. All
 * arithmetic that can affect a cent is performed with BigInt. Equal
 * remainders are awarded in ascending key order, independent of input order.
 */
export function allocateBigIntCentsByWeights(
  totalValueCents: bigint,
  slices: readonly WeightedExposureSlice[],
): BigIntAllocatedExposureSlice[] {
  validateSlices(slices);

  const sign = totalValueCents < BIGINT_ZERO ? -BIGINT_ONE : BIGINT_ONE;
  const absoluteTotal = totalValueCents < BIGINT_ZERO ? -totalValueCents : totalValueCents;
  const divisor = BigInt(BASIS_POINTS_SCALE);
  const rows = [...slices]
    .sort((left, right) => compareStableKeys(left.key, right.key))
    .map((slice) => {
      const numerator = absoluteTotal * BigInt(slice.weightBps);
      return {
        ...slice,
        absoluteValueCents: numerator / divisor,
        remainder: numerator % divisor,
      };
    });

  const allocatedFloor = rows.reduce(
    (total, row) => total + row.absoluteValueCents,
    BIGINT_ZERO,
  );
  const remainingCents = absoluteTotal - allocatedFloor;
  const remainderOrder = rows.toSorted(compareRemainders);

  for (let index = 0; index < Number(remainingCents); index += 1) {
    remainderOrder[index].absoluteValueCents += BIGINT_ONE;
  }

  return rows.map(({ key, weightBps, absoluteValueCents }) => ({
    key,
    weightBps,
    valueCents: absoluteValueCents * sign,
  }));
}

export function allocateCentsByWeights(
  totalValueCents: number,
  slices: readonly WeightedExposureSlice[],
): AllocatedExposureSlice[] {
  assertSafeInteger(totalValueCents, "totalValueCents");
  return allocateBigIntCentsByWeights(BigInt(totalValueCents), slices).map((slice) => ({
    ...slice,
    valueCents: toSafeNumber(slice.valueCents, `allocation.${slice.key}.valueCents`),
  }));
}

export const allocateCentsByExposure = allocateCentsByWeights;

interface ProportionalRow {
  key: string;
  numerator: bigint;
}

function apportionNonnegativeUnits(totalUnits: bigint, rows: readonly ProportionalRow[]) {
  const denominator = rows.reduce((total, row) => total + row.numerator, BIGINT_ZERO);
  if (denominator === BIGINT_ZERO) {
    return new Map(rows.map((row) => [row.key, BIGINT_ZERO]));
  }

  const allocations = rows.map((row) => {
    const numerator = totalUnits * row.numerator;
    return {
      ...row,
      units: numerator / denominator,
      remainder: numerator % denominator,
    };
  });
  const floorTotal = allocations.reduce((total, row) => total + row.units, BIGINT_ZERO);
  const remaining = Number(totalUnits - floorTotal);
  const remainderOrder = allocations.toSorted(compareRemainders);
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index].units += BIGINT_ONE;
  }
  return new Map(allocations.map((row) => [row.key, row.units]));
}

function configuredExposures(source: AllocationSource, dimension: ExposureDimension) {
  if (dimension === "ASSET_CLASS") return source.assetClassExposures;
  if (dimension === "GEOGRAPHY") return source.geographyExposures;
  return source.securityExposures;
}

function exposuresForDimension(source: AllocationSource, dimension: ExposureDimension) {
  const configured = configuredExposures(source, dimension);
  return configured && configured.length > 0
    ? configured
    : [{ key: UNKNOWN_EXPOSURE_KEY, weightBps: BASIS_POINTS_SCALE }];
}

function validateSources(sources: readonly AllocationSource[]) {
  const sourceIds = new Set<string>();
  for (const [index, source] of sources.entries()) {
    if (typeof source.id !== "string" || source.id.length === 0 || source.id.trim() !== source.id) {
      throw new AllocationValidationError(
        "INVALID_SOURCE",
        `sources[${index}].id must be a non-empty, trimmed string.`,
        `sources[${index}].id`,
      );
    }
    if (sourceIds.has(source.id)) {
      throw new AllocationValidationError(
        "DUPLICATE_SOURCE",
        `Allocation source ${source.id} appears more than once.`,
        `sources[${index}].id`,
      );
    }
    sourceIds.add(source.id);
    assertSafeInteger(source.valueCents, `sources[${index}].valueCents`);
    if (source.valueCents < 0) {
      throw new AllocationValidationError(
        "INVALID_CENTS",
        `sources[${index}].valueCents cannot be negative.`,
        `sources[${index}].valueCents`,
      );
    }
  }
}

export function calculateDimensionAllocation(
  sources: readonly AllocationSource[],
  dimension: ExposureDimension,
): DimensionAllocation {
  validateSources(sources);

  const sourceAllocations: SourceAllocation[] = [];
  const bucketValues = new Map<string, bigint>();
  const sortedSources = [...sources].sort((left, right) => compareStableKeys(left.id, right.id));
  for (const source of sortedSources) {
    const slices = exposuresForDimension(source, dimension);
    const allocations = allocateCentsByWeights(source.valueCents, slices);
    for (const allocation of allocations) {
      sourceAllocations.push({
        sourceId: source.id,
        key: allocation.key,
        sourceWeightBps: allocation.weightBps,
        valueCents: allocation.valueCents,
      });
      bucketValues.set(
        allocation.key,
        (bucketValues.get(allocation.key) ?? BIGINT_ZERO) + BigInt(allocation.valueCents),
      );
    }
  }

  const bucketRows = [...bucketValues.entries()]
    .sort(([left], [right]) => compareStableKeys(left, right))
    .map(([key, numerator]) => ({ key, numerator }));
  const totalValue = bucketRows.reduce((total, row) => total + row.numerator, BIGINT_ZERO);
  const allocatedBps = apportionNonnegativeUnits(BigInt(BASIS_POINTS_SCALE), bucketRows);
  const buckets = bucketRows.map(({ key, numerator }) => ({
    key,
    valueCents: toSafeNumber(numerator, `${dimension}.${key}.valueCents`),
    allocationBps: toSafeNumber(
      // Apportionment returns an entry for every bucket, including zero balances.
      allocatedBps.get(key)!,
      `${dimension}.${key}.allocationBps`,
    ),
  }));

  return {
    dimension,
    totalValueCents: toSafeNumber(totalValue, `${dimension}.totalValueCents`),
    unknownValueCents: toSafeNumber(
      bucketValues.get(UNKNOWN_EXPOSURE_KEY) ?? BIGINT_ZERO,
      `${dimension}.unknownValueCents`,
    ),
    buckets,
    sourceAllocations,
  };
}

export function calculateAllocation(sources: readonly AllocationSource[]): PortfolioAllocation {
  validateSources(sources);
  const totalValueCents = toSafeNumber(
    sources.reduce((total, source) => total + BigInt(source.valueCents), BIGINT_ZERO),
    "totalValueCents",
  );
  return {
    totalValueCents,
    assetClass: calculateDimensionAllocation(sources, "ASSET_CLASS"),
    geography: calculateDimensionAllocation(sources, "GEOGRAPHY"),
    security: calculateDimensionAllocation(sources, "SECURITY"),
  };
}

export function calculateLiquidityTotals(sources: readonly LiquiditySource[]): LiquidityTotals {
  const totals: Record<LiquidityClass, bigint> = {
    IMMEDIATE: BIGINT_ZERO,
    LIQUID: BIGINT_ZERO,
    RESTRICTED: BIGINT_ZERO,
    LOCKED: BIGINT_ZERO,
    UNKNOWN: BIGINT_ZERO,
  };
  const sourceIds = new Set<string>();

  for (const [index, source] of sources.entries()) {
    if (typeof source.id !== "string" || source.id.length === 0 || sourceIds.has(source.id)) {
      throw new AllocationValidationError(
        sourceIds.has(source.id) ? "DUPLICATE_SOURCE" : "INVALID_SOURCE",
        `sources[${index}].id must be non-empty and unique.`,
        `sources[${index}].id`,
      );
    }
    sourceIds.add(source.id);
    assertSafeInteger(source.valueCents, `sources[${index}].valueCents`);
    if (source.valueCents < 0) {
      throw new AllocationValidationError(
        "INVALID_CENTS",
        `sources[${index}].valueCents cannot be negative.`,
        `sources[${index}].valueCents`,
      );
    }
    const liquidityClass = source.liquidityClass ?? "UNKNOWN";
    if (!LIQUIDITY_CLASSES.has(liquidityClass)) {
      throw new AllocationValidationError(
        "INVALID_SOURCE",
        `sources[${index}].liquidityClass is not supported.`,
        `sources[${index}].liquidityClass`,
      );
    }
    totals[liquidityClass] += BigInt(source.valueCents);
  }

  const totalValue = Object.values(totals).reduce(
    (total, value) => total + value,
    BIGINT_ZERO,
  );
  return {
    totalValueCents: toSafeNumber(totalValue, "totalValueCents"),
    immediateValueCents: toSafeNumber(totals.IMMEDIATE, "immediateValueCents"),
    liquidValueCents: toSafeNumber(totals.LIQUID, "liquidValueCents"),
    restrictedValueCents: toSafeNumber(totals.RESTRICTED, "restrictedValueCents"),
    lockedValueCents: toSafeNumber(totals.LOCKED, "lockedValueCents"),
    unknownValueCents: toSafeNumber(totals.UNKNOWN, "unknownValueCents"),
    accessibleValueCents: toSafeNumber(
      totals.IMMEDIATE + totals.LIQUID,
      "accessibleValueCents",
    ),
  };
}
