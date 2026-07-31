export const CIO_STRATEGY_REPORT_COOLDOWN_DAYS = 30;

const CIO_STRATEGY_REPORT_COOLDOWN_MS = CIO_STRATEGY_REPORT_COOLDOWN_DAYS * 24 * 60 * 60 * 1_000;

export function cioStrategyReportNextAvailableAt(generatedAt: Date | string) {
  const timestamp = generatedAt instanceof Date ? generatedAt.getTime() : Date.parse(generatedAt);
  return new Date(timestamp + CIO_STRATEGY_REPORT_COOLDOWN_MS);
}

export function isCioStrategyReportOnCooldown(generatedAt: Date | string, now = new Date()) {
  return now < cioStrategyReportNextAvailableAt(generatedAt);
}
