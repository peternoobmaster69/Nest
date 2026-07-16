const RULES = [
  {
    intent: "knowledge_search",
    tools: ["search_workspace_knowledge"],
    retrieval: true,
    patterns: [
      /\b(?:note|notes|receipt|receipts|statement|statements|email|emails|document|documents|pdf|attachment|attachments)\b.*\b(?:say|said|show|mention|contain|according|find|search|summari[sz]e|explain)\b/,
      /\b(?:what|where|find|search|show|summari[sz]e|explain)\b.*\b(?:note|notes|receipt|receipts|statement|statements|email|emails|document|documents|pdf|attachment|attachments)\b/,
      /\baccording to\b.*\b(?:note|notes|receipt|receipts|statement|statements|email|emails|document|documents|pdf|attachment|attachments)\b/,
    ],
  },
  {
    intent: "cash_flow_change",
    tools: ["explain_cash_flow_change"],
    patterns: [
      /\b(?:cash ?flow|net (?:cash|flow)|money left|net change)\b.*\b(?:change|changed|lower|higher|down|up|why|compare|versus|vs)\b/,
      /\b(?:why|what)\b.*\b(?:cash ?flow|net (?:cash|flow)|money left)\b/,
      /\b(?:compare|change|changed)\b.*\b(?:cash ?flow|net (?:cash|flow)|money left)\b/,
    ],
  },
  {
    intent: "income_comparison",
    tools: ["compare_income"],
    patterns: [
      /\b(?:income|salary|salaries|earned|earnings|inflow|inflows|money in|paycheck|paychecks)\b.*\b(?:compare|change|changed|lower|higher|down|up|versus|vs|last|previous)\b/,
      /\b(?:compare|change|changed)\b.*\b(?:income|salary|earnings|inflow|money in)\b/,
    ],
  },
  {
    intent: "recurring_spend",
    tools: ["find_recurring_spend"],
    patterns: [
      /\b(?:recurring|repeat(?:ed|ing)?|subscription|subscriptions|regular (?:weekly |monthly |annual )?payments?|every month|monthly charge|weekly charge|annual charge)\b/,
    ],
  },
  {
    intent: "budget_vs_actual",
    tools: ["get_budget_vs_actual"],
    patterns: [
      /\b(?:budget|plan|planned|allocation|allocated)\b.*\b(?:actual|actually|spend|spent|spending|variance|remaining|used|against|versus|vs)\b/,
      /\b(?:actual|spent|spending)\b.*\b(?:budget|plan|planned|allocation)\b/,
    ],
  },
  {
    intent: "category_spending",
    tools: ["get_category_spending"],
    patterns: [
      /\b(?:how much|total|show|what|compare|spent|spend|spending|expenses?|cost|costs)\b.*\b(?:transport|transportation|commut(?:e|ing)|taxi|transit|dining|food|restaurants?|meals?|groceries|grocery|supermarket|utilities|utility|electricity|water|internet|housing|rent|mortgage|shopping|retail|clothes|clothing|entertainment|movies|gaming|healthcare|health|medical|dental|education|school|tuition|travel|flights?|hotels?|insurance|personal care|childcare|pets?|fees?|taxes|gifts?|charity|donations?)\b/,
      /\b(?:transport|transportation|commut(?:e|ing)|taxi|transit|dining|food|restaurants?|meals?|groceries|grocery|supermarket|utilities|utility|electricity|water|internet|housing|rent|mortgage|shopping|retail|clothes|clothing|entertainment|movies|gaming|healthcare|health|medical|dental|education|school|tuition|travel|flights?|hotels?|insurance|personal care|childcare|pets?|fees?|taxes|gifts?|charity|donations?)\b.*\b(?:spend|spent|spending|expense|expenses|cost|costs|compare|change|changed|breakdown|total)\b/,
      /\b(?:spend|spending|expense|expenses)\b.*\b(?:by|across)\s+(?:semantic |real world )?categor(?:y|ies)\b/,
      /\b(?:which|what|show|break down|breakdown|top)\b.*\bcategor(?:y|ies)\b.*\b(?:spend|spending|expense|expenses|money)\b/,
      /\bcategor(?:y|ies)\b.*\b(?:drive|drives|drove|driving|breakdown|total)\b.*\b(?:spend|spending|expense|expenses|money)\b/,
    ],
  },
  {
    intent: "spending_drivers",
    tools: ["get_top_spending_drivers"],
    patterns: [
      /\b(?:top|biggest|largest|main|most|highest)\b.*\b(?:spend|spending|expense|expenses|merchant|merchants|category|categories|money go)\b/,
      /\b(?:where|what|why)\b.*\b(?:money go|spent (?:the )?most|drove spending|driving spending|biggest expense|largest expense)\b/,
      /\b(?:merchant|merchants|category|categories)\b.*\b(?:drive|drives|drove|driving)\b.*\bspending\b/,
    ],
  },
  {
    intent: "spending_comparison",
    tools: ["compare_spending"],
    patterns: [
      /\b(?:spend|spending|expense|expenses|outflow|outflows)\b.*\b(?:compare|change|changed|lower|higher|down|up|versus|vs|last|previous)\b/,
      /\b(?:compare|change|changed)\b.*\b(?:spend|spending|expense|expenses|outflow)\b/,
    ],
  },
  {
    intent: "spending_breakdown",
    tools: ["get_spending_breakdown"],
    patterns: [
      /\b(?:breakdown|trend|monthly|yearly|annual|by month|by year|by sub-account|by category)\b.*\b(?:spend|spending|expense|expenses)\b/,
      /\b(?:spend|spending|expense|expenses)\b.*\b(?:breakdown|trend|monthly|yearly|annual|by month|by year|by sub-account|by category)\b/,
    ],
  },
  {
    intent: "card_obligations",
    tools: ["get_card_obligations"],
    patterns: [/\b(?:card|credit card)\b.*\b(?:due|outstanding|owe|obligation|payment)\b/],
  },
  {
    intent: "card_transactions",
    tools: ["find_card_transactions"],
    patterns: [/\b(?:card|credit card)\b.*\b(?:transaction|transactions|charge|charges|unallocated|allocated|merchant)\b/],
  },
  {
    intent: "receivables",
    tools: ["get_receivables"],
    patterns: [/\b(?:receivable|receivables|owed to me|owes me|money owed|unpaid invoice|unpaid invoices)\b/],
  },
  {
    intent: "reconciliation",
    tools: ["explain_reconciliation"],
    patterns: [/\b(?:reconcil|discrepanc|mismatch|doesnt match|doesn.t match|do not match|balance (?:does not |doesnt |not )?match|balance difference|balances differ)\w*\b/],
  },
  {
    intent: "investments",
    tools: ["get_investment_summary"],
    patterns: [/\b(?:investment|investments|portfolio|invested|valuation|gain|loss)\b/],
  },
  {
    intent: "trip_spending",
    tools: ["get_trip_spending"],
    patterns: [/\b(?:trip|trips|travel|travelled|traveled|holiday|holidays|vacation|vacations|destination|destinations)\b/],
  },
  {
    intent: "budget_plan",
    tools: ["get_budget_plan"],
    patterns: [/\b(?:budget plan|monthly plan|planned allocations|budget sources|allocation plan)\b/],
  },
  {
    intent: "financial_snapshot",
    tools: ["get_financial_snapshot"],
    patterns: [
      /\b(?:financial snapshot|overview|overall finances|financial status|how am i doing|how are we doing|this month so far)\b/,
    ],
  },
  {
    intent: "transactions",
    tools: ["find_transactions"],
    patterns: [/\b(?:transaction|transactions|purchase|purchases|payment|payments|merchant|charged|paid)\b/],
  },
];

export const ASK_NEST_INTENT_VERSION = "2026-07-16.2";

export function normalizeAskNestQuestion(value) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9$%\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAskNestIntent(question, pagePath = "/") {
  const normalized = normalizeAskNestQuestion(question);
  const matched = RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(normalized)));
  if (matched) {
    return {
      version: ASK_NEST_INTENT_VERSION,
      intent: matched.intent,
      recommendedTools: matched.tools,
      needsHybridRetrieval: Boolean(matched.retrieval),
      confidence: "HIGH",
    };
  }

  const pageFallbacks = {
    "/credit-transactions": "find_card_transactions",
    "/credit-cards": "get_card_obligations",
    "/receivables": "get_receivables",
    "/investments": "get_investment_summary",
    "/budgets/plan": "get_budget_plan",
    "/transactions": "find_transactions",
  };
  const fallbackTool = pageFallbacks[pagePath] ?? "get_financial_snapshot";
  return {
    version: ASK_NEST_INTENT_VERSION,
    intent: pageFallbacks[pagePath] ? "page_context" : "financial_snapshot",
    recommendedTools: [fallbackTool],
    needsHybridRetrieval: false,
    confidence: "LOW",
  };
}

export function buildAskNestPlanningHint(question, pagePath = "/") {
  const result = classifyAskNestIntent(question, pagePath);
  return [
    `Router version: ${result.version}.`,
    `Likely intent: ${result.intent}.`,
    `Recommended first tool: ${result.recommendedTools.join(", ")}.`,
    result.needsHybridRetrieval
      ? "The question appears to require workspace knowledge retrieval."
      : "The question appears answerable from structured Nest data.",
    "This is a deterministic hint, not evidence. Override it only when the user's wording or successful tool output clearly requires another read-only tool.",
  ].join(" ");
}
