import { ASK_NEST_ANSWER_MAX_LENGTH } from "./ask-nest-contracts";

type GeneratedCioAnswer = {
  answer: string;
  highlights: Array<{ label: string; value: string }>;
};

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const YEAR_PATTERN = /\b(?:19|20|21)\d{2}\b/g;
const NUMBER_PATTERN = /\d+(?:,\d+)*(?:\.\d+)?/g;
const MONEY_NUMBER_PATTERN = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const CURRENCY_PREFIX_PATTERN = /(?<![A-Z0-9_-])(-?)(SGD|USD|EUR|GBP|AUD|JPY)\s+/g;
const PERIODIC_PREFIX_PATTERN = /\b(?:monthly|annual|yearly)\s+(?:spending|budget|income|contribution|amount|target|expenses?)\s*(?:of|is|at|=)?\s*/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function successfulCioOutputs(outputs: readonly Record<string, unknown>[]) {
  return outputs.filter((output) => output.domain === "CIO" && output.ok === true);
}

function successfulFinancialGroundingOutputs(outputs: readonly Record<string, unknown>[]) {
  return outputs.filter((output) => (
    (output.domain === "CIO" || output.domain === "PUBLIC_FINANCIAL_RESEARCH") && output.ok === true
  ));
}

function percentageValues(value: string) {
  const suffix = /\s*%/y;
  const percentages: Array<{ rendered: string; amount: number }> = [];
  // Consume each numeric token once; a missing unit must not retry every digit.
  for (const match of value.matchAll(/-?[\d,]+(?:\.\d+)?/g)) {
    suffix.lastIndex = match.index + match[0].length;
    const unit = suffix.exec(value);
    if (unit) percentages.push({ rendered: `${match[0]}${unit[0]}`, amount: Number(match[0].replaceAll(",", "")) });
  }
  return percentages;
}

function isMoneyNumber(match: RegExpExecArray, value: string) {
  const end = match.index + match[0].length;
  return MONEY_NUMBER_PATTERN.test(match[0]) && !/^\.\d/.test(value.slice(end, end + 2));
}

function currencyValues(value: string) {
  const number = /-?\d+(?:,\d+)*(?:\.\d+)?/y;
  const values: Array<{ rendered: string; currency: string; amount: number; fractionDigits: number; normalized: string }> = [];
  for (const prefix of value.matchAll(CURRENCY_PREFIX_PATTERN)) {
    number.lastIndex = prefix.index + prefix[0].length;
    const match = number.exec(value);
    if (!match || !isMoneyNumber(match, value) || value[number.lastIndex] === ",") continue;
    const rawNumeric = match[0].replaceAll(",", "");
    const numeric = Number(rawNumeric);
    const signed = prefix[1] === "-" || numeric < 0 ? -Math.abs(numeric) : numeric;
    values.push({
      rendered: `${prefix[0]}${match[0]}`,
      currency: prefix[2],
      amount: signed,
      fractionDigits: rawNumeric.split(".")[1]?.length ?? 0,
      normalized: `${prefix[2]}:${signed}`,
    });
  }
  return values;
}

function isSupportedCurrencyValue(
  candidate: ReturnType<typeof currencyValues>[number],
  supported: ReturnType<typeof currencyValues>,
) {
  if (supported.some((value) => value.normalized === candidate.normalized)) return true;
  if (candidate.fractionDigits !== 0) return false;
  return supported.some((value) => (
    value.currency === candidate.currency
    && Math.sign(value.amount) * Math.round(Math.abs(value.amount)) === candidate.amount
  ));
}

function renderedAnswerText(generated: GeneratedCioAnswer) {
  return [
    generated.answer,
    ...generated.highlights.flatMap((highlight) => [highlight.label, highlight.value]),
  ].join("\n");
}

export function isReferentialFinancialFollowUp(value: string) {
  return [
    /\b(?:compare|benchmark|test|model|use|apply|recalculate|explain|show)\s+(?:this|that|it|these|those)\b/i,
    /\b(?:this|that|these|those)\s+(?:amount|figure|value|target|budget|scenario|projection|result|plan)\b/i,
    /\b(?:above|previous|same)\s+(?:answer|amount|figure|value|target|budget|scenario|projection|result|plan)\b/i,
  ].some((pattern) => pattern.test(value));
}

export function userSuppliedCurrencyGrounding(values: readonly string[], currency: string) {
  const supported = new Set<string>();
  for (const value of values) {
    for (const amount of periodicAmounts(value)) supported.add(`${currency} ${amount}`);
  }
  return [...supported];
}

function periodicAmounts(value: string) {
  const amounts: string[] = [];
  const period = /\s*(?:a|per|each|\/)\s*(?:month|year)\b/iy;
  for (const match of value.matchAll(NUMBER_PATTERN)) {
    if (value[match.index - 1] === ",") continue;
    period.lastIndex = match.index + match[0].length;
    if (period.test(value) && isMoneyNumber(match, value)) amounts.push(match[0]);
  }
  const number = /\d+(?:,\d+)*(?:\.\d+)?/y;
  for (const prefix of value.matchAll(PERIODIC_PREFIX_PATTERN)) {
    number.lastIndex = prefix.index + prefix[0].length;
    const match = number.exec(value);
    if (match && isMoneyNumber(match, value)) amounts.push(match[0]);
  }
  return amounts;
}

export function findUnsupportedCurrencyValue(
  generated: GeneratedCioAnswer,
  groundingText: readonly string[],
) {
  const supported = currencyValues(groundingText.join("\n"));
  return currencyValues(renderedAnswerText(generated))
    .find((value) => !isSupportedCurrencyValue(value, supported))?.rendered ?? null;
}

export function findUnsupportedCioValue(
  generated: GeneratedCioAnswer,
  outputs: readonly Record<string, unknown>[],
  allowedContext: readonly string[] = [],
) {
  const groundingOutputs = successfulFinancialGroundingOutputs(outputs);
  if (!groundingOutputs.length) return null;

  const rendered = renderedAnswerText(generated);
  const corpus = [JSON.stringify(groundingOutputs), ...allowedContext].join("\n");
  const unsupportedCurrency = findUnsupportedCurrencyValue(generated, [corpus]);
  if (unsupportedCurrency) return unsupportedCurrency;

  const supportedDates = new Set(corpus.match(DATE_PATTERN) ?? []);
  const unsupportedDate = (rendered.match(DATE_PATTERN) ?? []).find((date) => !supportedDates.has(date));
  if (unsupportedDate) return unsupportedDate;

  const supportedYears = new Set(corpus.match(YEAR_PATTERN) ?? []);
  const unsupportedYear = (rendered.match(YEAR_PATTERN) ?? []).find((year) => !supportedYears.has(year));
  if (unsupportedYear) return unsupportedYear;

  const supportedPercentages = new Set(percentageValues(corpus).map((value) => value.amount));
  const unsupportedPercentage = percentageValues(rendered).find((value) => (
    !supportedPercentages.has(value.amount)
  ));
  return unsupportedPercentage?.rendered ?? null;
}

function trimPartialWord(value: string) {
  let boundary = value.length;
  while (boundary > 0 && !/\s/.test(value[boundary - 1])) boundary -= 1;
  return (boundary > 0 ? value.slice(0, boundary) : value).trimEnd();
}

export function ensureCioDataDate(
  answer: string,
  outputs: readonly Record<string, unknown>[],
  maxLength = ASK_NEST_ANSWER_MAX_LENGTH,
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
    : trimPartialWord(answer.slice(0, available));
  return `${prefix}${prefix ? " " : ""}${suffix}`;
}
