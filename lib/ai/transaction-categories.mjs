export const TRANSACTION_CATEGORY_KEYS = Object.freeze([
  "TRANSPORT",
  "DINING",
  "GROCERIES",
  "UTILITIES",
  "HOUSING",
  "SHOPPING",
  "ENTERTAINMENT",
  "HEALTHCARE",
  "EDUCATION",
  "TRAVEL",
  "INSURANCE",
  "PERSONAL_CARE",
  "CHILDCARE",
  "PETS",
  "FEES",
  "TAXES",
  "GIFTS_CHARITY",
]);

export const TRANSACTION_CATEGORY_LABELS = Object.freeze({
  TRANSPORT: "Transport",
  DINING: "Dining",
  GROCERIES: "Groceries",
  UTILITIES: "Utilities",
  HOUSING: "Housing",
  SHOPPING: "Shopping",
  ENTERTAINMENT: "Entertainment",
  HEALTHCARE: "Healthcare",
  EDUCATION: "Education",
  TRAVEL: "Travel",
  INSURANCE: "Insurance",
  PERSONAL_CARE: "Personal care",
  CHILDCARE: "Childcare",
  PETS: "Pets",
  FEES: "Fees",
  TAXES: "Taxes",
  GIFTS_CHARITY: "Gifts and charity",
});

const CATEGORY_ALIASES = Object.freeze({
  TRANSPORT: ["transport", "transportation", "commute", "commuting", "taxi", "rides", "public transit", "bus", "train", "subway", "uber", "grabride", "gojek", "Transit", "Bus/MRT"],
  DINING: ["dining", "food", "restaurants", "meals", "eating out", "takeaway", "food delivery"],
  GROCERIES: ["groceries", "grocery", "supermarket", "food shopping"],
  UTILITIES: ["utilities", "utility", "household bills", "electricity", "water", "internet", "telco"],
  HOUSING: ["housing", "home", "rent", "mortgage"],
  SHOPPING: ["shopping", "retail", "clothes", "clothing", "apparel"],
  ENTERTAINMENT: ["entertainment", "leisure", "movies", "cinema", "gaming"],
  HEALTHCARE: ["healthcare", "health", "medical", "doctor", "dentist", "pharmacy"],
  EDUCATION: ["education", "school", "tuition", "courses", "learning"],
  TRAVEL: ["travel", "holidays", "vacations", "flights", "hotels"],
  INSURANCE: ["insurance", "premiums"],
  PERSONAL_CARE: ["personal care", "grooming", "beauty"],
  CHILDCARE: ["childcare", "children", "kids", "preschool"],
  PETS: ["pets", "pet care", "veterinary"],
  FEES: ["fees", "bank fees", "service charges"],
  TAXES: ["taxes", "tax"],
  GIFTS_CHARITY: ["gifts", "charity", "donations"],
});

const RULES = [
  // Specific multi-service merchant products must precede their ambiguous parent brands.
  rule("DINING", "HIGH", "FOOD_DELIVERY", /\b(?:grab\s*food|grabfood|go\s*food|gofood|uber\s*eats?|foodpanda|deliveroo|doordash)\b/i),
  rule("GROCERIES", "HIGH", "GROCERY_DELIVERY", /\b(?:grab\s*mart|grabmart|go\s*mart|gomart|redmart|amazon\s*fresh)\b/i),
  rule("TRANSPORT", "HIGH", "RIDE_HAILING", /\b(?:grab\s*(?:ride|car|taxi|transport)|grabride|go\s*(?:ride|car|taxi)|goride|gocar|uber(?!\s*eats?))\b/i),
  rule("TRANSPORT", "HIGH", "PUBLIC_TRANSIT", /\b(?:simplygo|transitlink|smrt|sbs\s*transit|mrt|lrt|public\s*transit|transit|bus(?:\s*(?:fare|ticket))?|train(?:\s*(?:fare|ticket))?|ez\s*link|ezlink)\b/i),
  rule("TRANSPORT", "HIGH", "TAXI", /\b(?:comfortdelgro|comfort\s*delgro|cdg\s*zig|citycab|taxi|cabcharge|cab\s*fare)\b/i),

  rule("GROCERIES", "HIGH", "SUPERMARKET", /\b(?:ntuc|fairprice|sheng\s*siong|cold\s*storage|giant\s*supermarket|don\s*don\s*donki|mustafa\s*centre|supermarket|grocery|groceries)\b/i),
  rule("DINING", "HIGH", "RESTAURANT_CAFE", /\b(?:starbucks|coffee\s*bean|mcdonald'?s|mcd\b|kfc\b|burger\s*king|subway\b|restaurant|cafe|coffee\s*shop|hawker|kopitiam|toast\s*box|ya\s*kun|takeaway)\b/i),
  rule("UTILITIES", "HIGH", "HOUSEHOLD_UTILITY", /\b(?:sp\s*services|singapore\s*power|electricity|water\s*bill|gas\s*bill|sembcorp\s*power|geneco|senoko\s*energy|utilities?)\b/i),
  rule("UTILITIES", "HIGH", "TELECOM", /\b(?:singtel|starhub|m1|circles\s*life|myrepublic|viewqwest|broadband|internet\s*bill|mobile\s*bill|phone\s*bill|telco)\b/i),
  rule("HOUSING", "HIGH", "HOUSING_PAYMENT", /\b(?:mortgage|home\s*loan|monthly\s*rent|rental\s*payment|landlord|condo\s*(?:fee|fees|management)|town\s*council|maintenance\s*fee)\b/i),
  rule("TRAVEL", "HIGH", "FLIGHT_HOTEL", /\b(?:singapore\s*airlines|scoot|jetstar|airasia|cathay\s*pacific|emirates|qatar\s*airways|airline|airways|flight|agoda|booking\.com|airbnb|hotel|hostel|resort)\b/i),
  rule("SHOPPING", "HIGH", "RETAIL_MARKETPLACE", /\b(?:amazon|amzn|shopee|lazada|zalora|uniqlo|zara|h\s+and\s+m|ikea|courts|harvey\s*norman|department\s*store)\b/i),
  rule("ENTERTAINMENT", "HIGH", "MEDIA_GAMING", /\b(?:netflix|spotify|disney\s*\+?|hbo|max\b|youtube\s*premium|cinema|cineplex|golden\s*village|shaw\s*theatres|steam\b|playstation|xbox|nintendo)\b/i),
  rule("HEALTHCARE", "HIGH", "MEDICAL", /\b(?:hospital|polyclinic|medical\s*clinic|dental|dentist|pharmacy|guardian\s*pharmacy|watsons\s*pharmacy|doctor|specialist\s*clinic|optical|optometrist)\b/i),
  rule("EDUCATION", "HIGH", "EDUCATION", /\b(?:school\s*fee|tuition|university|polytechnic|college\s*fee|coursera|udemy|skillshare|course\s*fee|exam\s*fee|textbook)\b/i),
  rule("INSURANCE", "HIGH", "INSURANCE", /\b(?:insurance|aia\b|prudential|great\s*eastern|income\s*insurance|fwd\b|singlife|manulife|aviva)\b/i),
  rule("PERSONAL_CARE", "HIGH", "PERSONAL_CARE", /\b(?:hair\s*salon|barber|beauty\s*salon|nail\s*salon|manicure|pedicure|spa\b|massage|facial\b|grooming)\b/i),
  rule("CHILDCARE", "HIGH", "CHILDCARE", /\b(?:childcare|child\s*care|preschool|kindergarten|infant\s*care|student\s*care|daycare|day\s*care)\b/i),
  rule("PETS", "HIGH", "PET_CARE", /\b(?:veterinary|veterinarian|vet\s*clinic|pet\s*shop|pet\s*food|pet\s*grooming|pet\s*care)\b/i),
  rule("TAXES", "HIGH", "TAX", /\b(?:iras|income\s*tax|property\s*tax|road\s*tax|tax\s*payment)\b/i),
  rule("GIFTS_CHARITY", "HIGH", "GIFT_CHARITY", /\b(?:donation|charity|red\s*cross|giving\.sg|gift\s*(?:shop|purchase)|birthday\s*gift|wedding\s*gift)\b/i),
  rule("FEES", "HIGH", "FINANCIAL_FEE", /\b(?:annual\s*fee|bank\s*fee|late\s*fee|service\s*charge|finance\s*charge|foreign\s*transaction\s*fee|admin(?:istration)?\s*fee)\b/i),

  // Parent brands that cover multiple products are candidates, not confirmed totals.
  rule("TRANSPORT", "MEDIUM", "AMBIGUOUS_GRAB", /\bgrab(?:pay)?\b/i),
  rule("TRANSPORT", "MEDIUM", "AMBIGUOUS_GOJEK", /\bgojek\b/i),
];

function rule(category, confidence, name, pattern) {
  return { category, confidence, name, pattern };
}

function normalizeTransactionCategoryText(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9+.'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFromSubAccount(value) {
  const normalized = normalizeTransactionCategoryText(value);
  if (!normalized) return null;
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`))) {
      return category;
    }
  }
  return null;
}

/**
 * Deterministically classifies a transaction without an LLM or vector search.
 * Specific merchant/product text wins; a clearly named sub-account is a fallback.
 *
 * @param {{ subject?: string | null, details?: string | null, notes?: string | null, budgetName?: string | null }} transaction
 */
export function classifyTransactionCategory(transaction) {
  const merchantText = normalizeTransactionCategoryText([
    transaction.subject,
    transaction.details,
    transaction.notes,
  ].filter(Boolean).join(" "));
  const matchedRule = RULES.find((candidate) => candidate.pattern.test(merchantText));
  if (matchedRule) {
    return {
      category: matchedRule.category,
      label: TRANSACTION_CATEGORY_LABELS[matchedRule.category],
      confidence: matchedRule.confidence,
      source: "TRANSACTION_TEXT",
      rule: matchedRule.name,
    };
  }

  const budgetCategory = categoryFromSubAccount(transaction.budgetName);
  if (budgetCategory) {
    return {
      category: budgetCategory,
      label: TRANSACTION_CATEGORY_LABELS[budgetCategory],
      confidence: "HIGH",
      source: "SUB_ACCOUNT_NAME",
      rule: "EXPLICIT_CATEGORY_SUB_ACCOUNT",
    };
  }

  return {
    category: "UNKNOWN",
    label: "Uncategorized",
    confidence: "NONE",
    source: "NONE",
    rule: "NO_MATCH",
  };
}
