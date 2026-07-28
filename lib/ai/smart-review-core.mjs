const MERCHANT_NOISE = new Set([
  "auth",
  "card",
  "charge",
  "debit",
  "ending",
  "online",
  "payment",
  "pos",
  "purchase",
  "ref",
  "reference",
  "sg",
  "sgp",
  "singapore",
  "transaction",
  "visa",
]);

const MERCHANT_ABBREVIATIONS = new Set([
  "cimb",
  "dbs",
  "hsbc",
  "ikea",
  "ntuc",
  "ocbc",
  "posb",
  "uob",
]);

const MERCHANT_CANONICAL_NAMES = new Map([
  ["mcdonald", "McDonald"],
  ["mcdonalds", "McDonalds"],
]);

export function normalizeSmartReviewText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function merchantTokens(value) {
  return normalizeSmartReviewText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !MERCHANT_NOISE.has(token));
}

export function merchantFingerprint(value) {
  return [...new Set(merchantTokens(value))].slice(0, 8).join(" ");
}

export function merchantSimilarity(left, right) {
  const leftTokens = new Set(merchantTokens(left));
  const rightTokens = new Set(merchantTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union ? intersection / union : 0;
  const leftKey = [...leftTokens].join(" ");
  const rightKey = [...rightTokens].join(" ");
  if (leftKey === rightKey) return 1;
  if (leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey)) return Math.max(jaccard, 0.86);
  return jaccard;
}

export function displayMerchantName(value) {
  const tokens = merchantTokens(value).slice(0, 6);
  if (!tokens.length) return String(value ?? "Transaction").trim().slice(0, 80) || "Transaction";
  return tokens
    .map((token) => MERCHANT_CANONICAL_NAMES.get(token) ?? (
      token.length <= 3 || MERCHANT_ABBREVIATIONS.has(token)
        ? token.toLocaleUpperCase()
        : `${token[0].toLocaleUpperCase()}${token.slice(1)}`
    ))
    .join(" ")
    .slice(0, 80);
}

export function merchantNameRecommendation(originalValue, suggestedValue = displayMerchantName(originalValue)) {
  const original = String(originalValue ?? "").trim();
  const suggested = String(suggestedValue ?? "").trim();
  if (!original || !suggested) return null;

  const originalNormalized = normalizeSmartReviewText(original);
  const suggestedNormalized = normalizeSmartReviewText(suggested);
  if (!originalNormalized || originalNormalized === suggestedNormalized) return null;

  const originalWords = original.match(/[a-z0-9]+/gi) ?? [];
  const suggestedWords = suggested.match(/[a-z0-9]+/gi) ?? [];
  const originalMeaningfulWords = merchantTokens(original);
  const suggestedMeaningfulWords = merchantTokens(suggested);
  const removesWords = suggestedWords.length < originalWords.length ||
    suggestedMeaningfulWords.length < originalMeaningfulWords.length;
  if (!removesWords) return null;

  const originalTokenSet = new Set(originalMeaningfulWords);
  if (suggestedMeaningfulWords.some((token) => !originalTokenSet.has(token))) return null;
  return suggested.slice(0, 80);
}

export function hasReceivableLanguage(value) {
  const normalized = normalizeSmartReviewText(value);
  return /\b(?:claim|family|friend|loaned|mom|mum|reimburse|reimbursable|reimbursement|split|together)\b/.test(normalized);
}

export function isConsistentHistory(topCount, totalCount) {
  return topCount >= 3 && totalCount > 0 && topCount / totalCount >= 0.75;
}
