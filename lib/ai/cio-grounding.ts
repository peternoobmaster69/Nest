type GeneratedCioAnswer = {
  answer: string;
  highlights: Array<{ label: string; value: string }>;
};

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const PERCENTAGE_PATTERN = /(-?[\d,]+(?:\.\d+)?)\s*%/g;
const CURRENCY_PATTERN = /(?<![A-Z0-9_-])(-?)(SGD|USD|EUR|GBP|AUD|JPY)\s+(-?[\d,]+(?:\.\d{2})?)(?![\d.])/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function successfulCioOutputs(outputs: readonly Record<string, unknown>[]) {
  return outputs.filter((output) => output.domain === "CIO" && output.ok === true);
}

function normalizedPercentages(value: string) {
  return [...value.matchAll(PERCENTAGE_PATTERN)].map((match) => (
    Number(match[1].replaceAll(",", ""))
  ));
}

function currencyValues(value: string) {
  return [...value.matchAll(CURRENCY_PATTERN)].map((match) => {
    const numeric = Number(match[3].replaceAll(",", ""));
    const signed = match[1] === "-" || numeric < 0 ? -Math.abs(numeric) : numeric;
    return { rendered: match[0], normalized: `${match[2]}:${signed}` };
  });
}

export function findUnsupportedCioValue(
  generated: GeneratedCioAnswer,
  outputs: readonly Record<string, unknown>[],
) {
  const cioOutputs = successfulCioOutputs(outputs);
  if (!cioOutputs.length) return null;

  const rendered = [
    generated.answer,
    ...generated.highlights.flatMap((highlight) => [highlight.label, highlight.value]),
  ].join("\n");
  const corpus = JSON.stringify(cioOutputs);
  const supportedCurrencyValues = new Set(currencyValues(corpus).map((value) => value.normalized));
  const unsupportedCurrency = currencyValues(rendered).find((value) => !supportedCurrencyValues.has(value.normalized));
  if (unsupportedCurrency) return unsupportedCurrency.rendered;

  const supportedDates = new Set(corpus.match(DATE_PATTERN) ?? []);
  const unsupportedDate = (rendered.match(DATE_PATTERN) ?? []).find((date) => !supportedDates.has(date));
  if (unsupportedDate) return unsupportedDate;

  const supportedPercentages = new Set(normalizedPercentages(corpus));
  const generatedPercentageMatches = [...rendered.matchAll(PERCENTAGE_PATTERN)];
  const unsupportedPercentage = generatedPercentageMatches.find((match) => (
    !supportedPercentages.has(Number(match[1].replaceAll(",", "")))
  ));
  return unsupportedPercentage?.[0] ?? null;
}

export function ensureCioDataDate(
  answer: string,
  outputs: readonly Record<string, unknown>[],
  maxLength = 1_600,
) {
  const dataDates = [...new Set(successfulCioOutputs(outputs).flatMap((output) => (
    isRecord(output) && typeof output.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(output.asOfDate)
      ? [output.asOfDate]
      : []
  )))];
  if (!dataDates.length || dataDates.every((date) => answer.includes(date))) return answer;

  const suffix = `${dataDates.length === 1 ? "Data date" : "Data dates"}: ${dataDates.join(", ")}.`;
  const available = Math.max(0, maxLength - suffix.length - 1);
  const prefix = answer.length <= available
    ? answer.trimEnd()
    : answer.slice(0, available).replace(/\s+\S*$/, "").trimEnd();
  return `${prefix}${prefix ? " " : ""}${suffix}`;
}
