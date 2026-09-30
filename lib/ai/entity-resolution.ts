import { prisma } from "@/lib/prisma";
import { normalizeEntityText, scorePair } from "./entity-matching";

export { isAskNestCategoryConcept, normalizeEntityText } from "./entity-matching";

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
