import { prisma } from "@/lib/prisma";

export type AskNestEntityKind = "ACCOUNT" | "BUDGET" | "CARD";

export type AskNestEntityCandidate = {
  id: string;
  label: string;
  aliases?: Array<string | null | undefined>;
};

export type AskNestEntityResolution = {
  kind: AskNestEntityKind;
  input: string;
  matched: boolean;
  ids: string[];
  labels: string[];
  confidence: number;
  method: "EXACT" | "ALIAS" | "CONCEPT" | "TOKEN" | "NONE";
};

const CONCEPT_GROUPS = [
  ["dining", "food", "restaurant", "restaurants", "meal", "meals", "eating", "cafe", "coffee", "takeaway", "delivery"],
  ["groceries", "grocery", "supermarket", "market", "food shopping"],
  ["transport", "transportation", "commute", "commuting", "taxi", "ride", "rides", "grab", "gojek", "uber", "transit"],
  ["travel", "trip", "trips", "holiday", "holidays", "vacation", "vacations", "flight", "flights", "hotel", "hotels"],
  ["utilities", "utility", "electricity", "water", "gas", "internet", "mobile", "phone", "telco"],
  ["shopping", "retail", "clothes", "clothing", "apparel"],
  ["health", "healthcare", "medical", "doctor", "dentist", "pharmacy"],
  ["entertainment", "leisure", "movies", "cinema", "games", "gaming"],
  ["education", "school", "tuition", "course", "courses", "books"],
  ["insurance", "premium", "premiums"],
  ["housing", "home", "rent", "mortgage"],
  ["savings", "saving", "emergency fund", "reserve"],
] as const;

const MERCHANT_ALIASES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Grab", pattern: /\bgrab(?:pay|food|taxi|car)?\b/i },
  { label: "Gojek", pattern: /\bgojek\b/i },
  { label: "Uber", pattern: /\buber\b/i },
  { label: "Starbucks", pattern: /\bstarbucks?\b/i },
  { label: "McDonald's", pattern: /\b(?:mcd(?:onalds?)?|mcdonalds?)\b/i },
  { label: "FairPrice", pattern: /\b(?:ntuc|fairprice)\b/i },
  { label: "Amazon", pattern: /\b(?:amazon|amzn)\b/i },
  { label: "Apple", pattern: /\bapple(?:\.com)?(?:\/bill)?\b/i },
  { label: "Google", pattern: /\bgoogle\s*\*|\bgoogle play\b/i },
  { label: "Shopee", pattern: /\bshopee\b/i },
  { label: "Lazada", pattern: /\blazada\b/i },
  { label: "Netflix", pattern: /\bnetflix\b/i },
  { label: "Spotify", pattern: /\bspotify\b/i },
];

export function normalizeEntityText(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return new Set(normalizeEntityText(value).split(" ").filter((token) => token.length >= 2));
}

function conceptGroup(value: string) {
  const normalized = normalizeEntityText(value);
  return CONCEPT_GROUPS.find((group) => group.some((term) => (
    normalized === term || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`) || normalized.includes(` ${term} `)
  ))) ?? null;
}

export function isAskNestCategoryConcept(value: string) {
  const normalized = normalizeEntityText(value);
  return normalized.split(" ").length <= 3 && CONCEPT_GROUPS.some((group) => group.includes(normalized as never));
}

function scorePair(input: string, candidate: string) {
  const query = normalizeEntityText(input);
  const value = normalizeEntityText(candidate);
  if (!query || !value) return { score: 0, method: "NONE" as const };
  if (query === value) return { score: 1, method: "EXACT" as const };
  if (value.includes(query) || query.includes(value)) return { score: 0.88, method: "ALIAS" as const };

  const queryConcept = conceptGroup(query);
  const valueConcept = conceptGroup(value);
  if (queryConcept && valueConcept && queryConcept === valueConcept) {
    return { score: 0.82, method: "CONCEPT" as const };
  }

  const queryTokens = tokens(query);
  const valueTokens = tokens(value);
  const intersection = [...queryTokens].filter((token) => valueTokens.has(token)).length;
  const union = new Set([...queryTokens, ...valueTokens]).size;
  const overlap = union ? intersection / union : 0;
  const queryAcronym = [...queryTokens].map((token) => token[0]).join("");
  const valueAcronym = [...valueTokens].map((token) => token[0]).join("");
  if (query.length >= 2 && (query === valueAcronym || value === queryAcronym)) {
    return { score: 0.8, method: "ALIAS" as const };
  }
  return { score: overlap, method: overlap ? "TOKEN" as const : "NONE" as const };
}

export function resolveAskNestEntity(
  kind: AskNestEntityKind,
  input: string,
  candidates: AskNestEntityCandidate[],
): AskNestEntityResolution {
  const scored = candidates.map((candidate) => {
    const values = [candidate.label, ...(candidate.aliases ?? []).filter((value): value is string => Boolean(value))];
    const best = values
      .map((value) => scorePair(input, value))
      .sort((left, right) => right.score - left.score)[0] ?? { score: 0, method: "NONE" as const };
    return { candidate, ...best };
  }).sort((left, right) => right.score - left.score || left.candidate.label.localeCompare(right.candidate.label));
  const top = scored[0];
  if (!top || top.score < 0.6) {
    return { kind, input, matched: false, ids: [], labels: [], confidence: top?.score ?? 0, method: "NONE" };
  }
  const matches = scored.filter((item) => item.score >= Math.max(0.72, top.score - 0.04));
  return {
    kind,
    input,
    matched: true,
    ids: matches.map((item) => item.candidate.id),
    labels: matches.map((item) => item.candidate.label),
    confidence: top.score,
    method: top.method,
  };
}

export async function resolveAskNestAccount(workspaceId: string, input: string | null) {
  if (!input) return null;
  const rows = await prisma.financialAccount.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, bankName: true },
  });
  return resolveAskNestEntity("ACCOUNT", input, rows.map((row) => ({
    id: row.id,
    label: row.name,
    aliases: [row.bankName],
  })));
}

export async function resolveAskNestBudget(workspaceId: string, input: string | null) {
  if (!input) return null;
  const rows = await prisma.budgetEnvelope.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true },
  });
  return resolveAskNestEntity("BUDGET", input, rows.map((row) => ({ id: row.id, label: row.name })));
}

export async function resolveAskNestCard(workspaceId: string, input: string | null) {
  if (!input) return null;
  const rows = await prisma.creditCardAccount.findMany({
    where: { workspaceId },
    select: { id: true, cardName: true, bankName: true },
  });
  return resolveAskNestEntity("CARD", input, rows.map((row) => ({
    id: row.id,
    label: row.cardName,
    aliases: [row.bankName],
  })));
}

export function canonicalizeMerchant(value: string) {
  const alias = MERCHANT_ALIASES.find((item) => item.pattern.test(value));
  if (alias) return alias.label;
  const cleaned = value
    .replace(/^(?:pos|visa|mastercard|debit|purchase|payment|paynow)\s*[-:*#]?\s*/i, "")
    .replace(/\b(?:sgp|singapore|sg)\b/gi, " ")
    .replace(/\d{3,}/g, " ")
    .replace(/[*#_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return value.trim();
  return cleaned.toLocaleLowerCase().replace(/\b\w/g, (character) => character.toLocaleUpperCase());
}

export function buildAskNestSearchTerms(value: string) {
  const normalized = normalizeEntityText(value);
  const terms = normalized.split(" ").filter((term) => term.length >= 2);
  return [...new Set([value.trim(), normalized, ...terms].filter(Boolean))].slice(0, 8);
}
