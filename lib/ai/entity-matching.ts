// Pure, dependency-free name matching shared by Ask Nest and the transaction assistant.
export type EntityMatchMethod = "EXACT" | "ALIAS" | "CONCEPT" | "TOKEN" | "NONE";

export const CONCEPT_GROUPS = [
  ["dining", "food", "restaurant", "restaurants", "meal", "meals", "eating", "cafe", "coffee", "takeaway", "delivery", "lunch", "dinner", "breakfast", "hawker", "makan"],
  ["groceries", "grocery", "supermarket", "market", "food shopping", "ntuc", "fairprice", "sheng siong", "cold storage"],
  ["transport", "transportation", "commute", "commuting", "taxi", "ride", "rides", "grab", "gojek", "uber", "transit", "mrt", "bus", "train", "public transport", "ez link", "ezlink", "parking", "petrol", "fuel"],
  ["travel", "trip", "trips", "holiday", "holidays", "vacation", "vacations", "flight", "flights", "hotel", "hotels"],
  ["utilities", "utility", "electricity", "water", "gas", "internet", "mobile", "phone", "telco", "bills", "bill"],
  ["shopping", "retail", "clothes", "clothing", "apparel"],
  ["health", "healthcare", "medical", "doctor", "dentist", "pharmacy"],
  ["entertainment", "leisure", "movies", "cinema", "games", "gaming"],
  ["education", "school", "tuition", "course", "courses", "books"],
  ["insurance", "premium", "premiums"],
  ["housing", "home", "rent", "mortgage"],
  ["savings", "saving", "emergency fund", "reserve"],
] as const;

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

export function conceptGroup(value: string) {
  const normalized = normalizeEntityText(value);
  return CONCEPT_GROUPS.find((group) => group.some((term) => (
    normalized === term || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`) || normalized.includes(` ${term} `)
  ))) ?? null;
}

export function isAskNestCategoryConcept(value: string) {
  const normalized = normalizeEntityText(value);
  return normalized.split(" ").length <= 3 && CONCEPT_GROUPS.some((group) => group.includes(normalized as never));
}

export function scorePair(input: string, candidate: string) {
  const query = normalizeEntityText(input);
  const value = normalizeEntityText(candidate);
  if (!query || !value) return { score: 0, method: "NONE" as EntityMatchMethod };
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
