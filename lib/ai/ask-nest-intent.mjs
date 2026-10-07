function ordered(...groups) {
  const alternatives = groups.map((group) => Array.isArray(group) ? group : [group]);
  return {
    test(value) {
      let remaining = value;
      for (const patterns of alternatives) {
        let nextEnd = Infinity;
        for (const pattern of patterns) {
          const match = pattern.exec(remaining);
          if (match) nextEnd = Math.min(nextEnd, match.index + match[0].length);
        }
        if (!Number.isFinite(nextEnd)) return false;
        remaining = remaining.slice(nextEnd);
      }
      return true;
    },
  };
}

const KNOWLEDGE_DOCUMENTS = /\b(?:notes?|receipts?|statements?|emails?|documents?|pdf|attachments?)\b/;
const REAL_PROJECTION_TERMS = [/\btodays[- ]money\b/, /\breal(?: values?| terms?)?\b/];
const NOMINAL_PROJECTION_TERMS = /\bnominal(?: values?| terms?)?\b/;
const PROJECTION_TERMS = [...REAL_PROJECTION_TERMS, NOMINAL_PROJECTION_TERMS];
const PROJECTION_QUESTION = /\b(?:what(?:s| is| are| do)?|define|explain)\b/;
const PROJECTION_COMPARISON = /\b(?:and|vs|versus|compared (?:with|to))\b/;
const MONTHLY_AMOUNT = /\b(?:sgd\s*)?\d(?:[\d,.]|\s(?=\d))*\s*(?:a month|per month|monthly)\b/;
const BENCHMARK_ASSESSMENT = /\b(?:too much|too high|too little|too low|enough|reasonable|realistic|adequate|comfortable)\b/;
const MONTHLY_BENCHMARK_PATTERNS = [ordered(MONTHLY_AMOUNT, BENCHMARK_ASSESSMENT), ordered(BENCHMARK_ASSESSMENT, MONTHLY_AMOUNT)];
const CATEGORY_TERMS = [
  /\b(?:transport|transportation|commut(?:e|ing)|taxi|transit)\b/,
  /\b(?:dining|food|restaurants?|meals?|groceries|grocery|supermarket)\b/,
  /\b(?:utilities|utility|electricity|water|internet|housing|rent|mortgage)\b/,
  /\b(?:shopping|retail|clothes|clothing|entertainment|movies|gaming)\b/,
  /\b(?:healthcare|health|medical|dental|education|school|tuition)\b/,
  /\b(?:travel|flights?|hotels?|insurance|personal care|childcare|pets?)\b/,
  /\b(?:fees?|taxes|gifts?|charity|donations?)\b/,
];
const STOCK_TERMS = /\b(?:stocks?|shares?|tickers?)\b/i;
const QUOTE_TERMS = [
  /\b(?:prices?|quotes?|perform(?:ed|ance|ing)?|returns?)\b/i,
  /\b(?:ohlc|volume|high|low|close|market data)\b/i,
];

const RULES = [
  {
    intent: "knowledge_search",
    tools: ["search_workspace_knowledge"],
    retrieval: true,
    patterns: [
      ordered(KNOWLEDGE_DOCUMENTS, /\b(?:say|said|show|mention|contain|according|find|search|summari[sz]e|explain)\b/),
      ordered(/\b(?:what|where|find|search|show|summari[sz]e|explain)\b/, KNOWLEDGE_DOCUMENTS),
      ordered(/\baccording to\b/, KNOWLEDGE_DOCUMENTS),
    ],
  },
  {
    intent: "market_news",
    tools: ["search_market_news"],
    patterns: [
      /\b(?:latest|recent|todays?|current|breaking)\b.*\b(?:news|headlines?|developments?|coverage|announcement|announcements)\b/,
      ordered(/\b(?:news|headlines?|developments?|coverage|announcements?)\b/, [
        /\b(?:about|for|on|from|market|markets|company|companies|stock|stocks)\b/,
        /\b(?:economy|economic|industry|sector|earnings|inflation|rates?)\b/,
      ]),
      /\b(?:what is|whats|what has been)\s+(?:happening|reported|announced)\b.*\b(?:company|stock|market|economy|industry|sector|earnings)\b/,
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
    intent: "cio_projection_terms",
    tools: [],
    pagePaths: ["/cio"],
    patterns: [
      ordered(/\bwhat does\b/, PROJECTION_TERMS, /\bmean\b/),
      /\b(?:what is|whats)\s+(?:todays[- ]money|nominal(?: terms?)?|real terms?)\b(?:\s+mean)?$/,
      ordered(/\b(?:meaning|definition) of\b/, PROJECTION_TERMS),
      ordered(PROJECTION_QUESTION, REAL_PROJECTION_TERMS, PROJECTION_COMPARISON, NOMINAL_PROJECTION_TERMS),
      ordered(PROJECTION_QUESTION, NOMINAL_PROJECTION_TERMS, PROJECTION_COMPARISON, REAL_PROJECTION_TERMS),
      ordered(REAL_PROJECTION_TERMS, /\b(?:and|vs|versus)\b/, NOMINAL_PROJECTION_TERMS, /\b(?:mean|meaning|difference)\b/),
      ordered(NOMINAL_PROJECTION_TERMS, /\b(?:and|vs|versus)\b/, REAL_PROJECTION_TERMS, /\b(?:mean|meaning|difference)\b/),
    ],
  },
  {
    intent: "cio_contribution_scenario",
    tools: ["compare_cio_contribution_scenarios"],
    patterns: [
      /\bwhat if\b.*\b(?:add|save|put)\b.*\b(?:each|per|a)\s+year\b/,
      /\b(?:what (?:happens|if)|scenario|compare|extra|additional|increase|decrease)\b.*\b(?:contribution|contributions|contribute|invest|investing)\b/,
      /\b(?:contribution|contributions|contribute|investing)\b.*\b(?:scenario|extra|additional|increase|decrease)\b/,
    ],
  },
  {
    intent: "cio_new_money_plan",
    tools: ["plan_cio_new_money", "get_cio_advisor_brief"],
    patterns: [
      ordered(/\b(?:where|how)\b/, /\b(?:should|do|can|would)\b/, /\b(?:i|we)\b/, /\b(?:put|invest|allocate|deploy|park)\b/, /\b(?:sgd|usd|\$|\d|bonus|savings|windfall|new money|extra cash|spare cash|lump sum)/),
      /\b(?:allocate|deploy|invest|split)\b.*\b(?:new money|bonus|windfall|lump sum|spare cash|extra cash)\b/,
      /\b(?:new money|bonus|windfall|lump sum)\b.*\b(?:allocate|invest|put|deploy|split|go)\b/,
    ],
  },
  {
    intent: "cio_public_financial_benchmark",
    tools: ["run_cio_retirement_projection", "search_public_financial_sources"],
    pagePaths: ["/cio"],
    patterns: [
      ...MONTHLY_BENCHMARK_PATTERNS,
      /\b(?:internet|web|public|external)\s+(?:source|sources|research|data|benchmark|benchmarks)\b/,
    ],
  },
  {
    intent: "retirement_public_benchmark",
    tools: ["run_cio_retirement_projection", "search_public_financial_sources"],
    patterns: [
      /\b(?:retire|retirement|retired)\b.*\b(?:too much|too high|too little|too low|enough|reasonable|realistic|adequate|comfortable|average|typical|benchmark)\b/,
      /\b(?:too much|too high|too little|too low|enough|reasonable|realistic|adequate|comfortable|average|typical|benchmark)\b.*\b(?:retire|retirement|retired)\b/,
      /\b(?:retire|retirement|retired)\b.*\b(?:internet|web|public|external)\s+(?:source|sources|research|data)\b/,
    ],
  },
  {
    intent: "public_financial_benchmark",
    tools: ["search_public_financial_sources"],
    patterns: [
      ...MONTHLY_BENCHMARK_PATTERNS,
      /\b(?:average|typical|benchmark|compare)\b.*\b(?:household expenditure|household spending|living costs?|monthly expenses?|retirement income|retirement budget)\b/,
    ],
  },
  {
    intent: "cio_retirement_projection",
    tools: ["run_cio_retirement_projection"],
    patterns: [
      /\b(?:can|could|will|may|should)\b.*\bretire\b.*\b(?:at|by|in)\s+(?:age\s*)?\d{2,3}\b/,
      /\b(?:retire|retirement|retiring)\b.*\b(?:in|by)\s+(?:19|20)\d{2}\b/,
      /\bhow much\b.*\b(?:need|enough|fund|income)\b.*\b(?:retire|retirement|retiring)\b/,
      /\b(?:retire|retirement|retiring)\b.*\b(?:track|projection|project|forecast|fund|income|age|when|enough|target)\b/,
      /\b(?:on track|project|forecast|sustainable income)\b.*\b(?:retire|retirement|retiring)\b/,
    ],
  },
  {
    intent: "cio_strategy_recommendations",
    tools: ["get_cio_advisor_brief", "get_cio_strategy_recommendations"],
    patterns: [
      /\b(?:recommend|recommendation|recommendations|strategy|action plan|priority actions?)\b.*\b(?:cio|portfolio|allocation|liquidity|contributions?|retirement|investments?)\b/,
      /\b(?:household|portfolio|investment|retirement|cio)\b.*\b(?:strategy|recommendation|recommendations|action plan)\b/,
      /\b(?:what should|what do)\b.*\b(?:we|i|household)\b.*\b(?:do|change|prioriti[sz]e)\b.*\b(?:portfolio|investments?|contributions?|retirement|liquidity)\b/,
      /\b(?:advise|guidance)\b.*\b(?:portfolio|allocation|contributions?|retirement|liquidity)\b/,
    ],
  },
  {
    intent: "cio_advice",
    tools: ["get_cio_advisor_brief"],
    patterns: [
      ordered([
        /\b(?:advice|advise|advisor|trade ?offs?)\b/,
        /\b(?:what should (?:i|we) do|how (?:can|do|should) (?:i|we) improve)\b/,
        /\bhow far (?:off|behind|away)\b/,
      ], /\b(?:invest|investments?|investing|portfolio|allocation|retire|retirement|contributions?|wealth|savings|money)\b/),
      ordered(/\b(?:invest|investments?|investing|portfolio|allocation|retire|retirement|contributions?|wealth)\b/, [
        /\b(?:advice|advise|improve|trade ?offs?|smarter|better)\b/,
        /\bwhat should (?:i|we) do\b/,
        /\bhow far (?:off|behind|away)\b/,
      ]),
      /\bretire\b.*\b(?:earlier|sooner)\b/,
    ],
  },
  {
    intent: "cio_policy",
    tools: ["get_cio_policy_status"],
    patterns: [
      /\b(?:policy|target band|allocation band|concentration limit|liquidity floor|emergency (?:fund|reserve))\b/,
      /\b(?:reduce|increase|rebalance|divest|sell|buy|hold)\b.*\b(?:allocation|portfolio|fixed[- ]income|equity|cash|investment)\b/,
      /\b(?:divest|rebalance)\b/,
    ],
  },
  {
    intent: "cio_overview",
    tools: ["get_cio_overview"],
    patterns: [
      /\b(?:cio|chief investment officer)\b/,
      /\b(?:true|current|household)\b.*\b(?:asset allocation|portfolio allocation|geographic exposure|liquidity runway)\b/,
      /\b(?:asset allocation|geographic exposure|liquidity runway|unclassified investment|stale investment|portfolio liquidity)\b/,
      /\b(?:how much|what percentage|what percent)\b.*\bportfolio\b.*\b(?:liquid|restricted|locked|unknown)\b/,
      /\b(?:how much|what is|show)\b.*\b(?:liquid|liquidity|readily available)\b/,
      /\b(?:liquid|liquidity|readily available)\b.*\b(?:emergency|runway)\b/,
      /\b(?:how much|enough|available|covered)\b.*\bemergency\b/,
      /\b(?:how much|what is|what are|show|summarize)\b.*\b(?:contribute|contribution|contributions|withdraw|withdrawal|withdrawals|reallocate|reallocation|reallocations)\b/,
      /\b(?:investment|investments|valuation|valuations)\b.*\b(?:stale|unclassified|unknown|missing)\b/,
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
      /\b(?:recurring|repeat(?:ed|ing)?|subscriptions?|every month|monthly charge|weekly charge|annual charge)\b/,
      /\bregular (?:weekly |monthly |annual )?payments?\b/,
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
      ordered(/\b(?:how much|total|show|what|compare|spent|spend|spending|expenses?|cost|costs)\b/, CATEGORY_TERMS),
      ordered(CATEGORY_TERMS, /\b(?:spend|spent|spending|expense|expenses|cost|costs|compare|change|changed|breakdown|total)\b/),
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
    intent: "market_data",
    tools: ["get_market_history"],
    patterns: [
      /\$[a-z]{1,5}\b/,
      ordered(STOCK_TERMS, QUOTE_TERMS),
      ordered(QUOTE_TERMS, STOCK_TERMS),
    ],
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

const ASK_NEST_INTENT_VERSION = "2026-10-01.1";

function hasExplicitMarketTicker(value) {
  if (/\$[A-Za-z][A-Za-z0-9.-]{0,14}\b/.test(value)) return true;
  const ignored = new Set(["A", "I", "US", "USD", "SGD", "EUR", "GBP", "AUD", "JPY", "ETF", "OHLC"]);
  return (value.match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g) ?? []).some((candidate) => !ignored.has(candidate));
}

function normalizeAskNestQuestion(value) {
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
  const hasMarketNewsLanguage = /\b(?:news|headlines?|developments?|coverage|announc(?:e|ed|ement|ements)|happening|happened|reported)\b/i.test(question);
  const hasMarketDataLanguage = /\b(?:stocks?|shares?)\b/i.test(question) || QUOTE_TERMS.some((pattern) => pattern.test(question));
  if (hasExplicitMarketTicker(question) && hasMarketNewsLanguage && hasMarketDataLanguage) {
    return {
      version: ASK_NEST_INTENT_VERSION,
      intent: "market_data_and_news",
      recommendedTools: ["get_market_history", "search_market_news"],
      needsHybridRetrieval: false,
      confidence: "HIGH",
    };
  }
  if (hasExplicitMarketTicker(question) && hasMarketNewsLanguage) {
    return {
      version: ASK_NEST_INTENT_VERSION,
      intent: "market_news",
      recommendedTools: ["search_market_news"],
      needsHybridRetrieval: false,
      confidence: "HIGH",
    };
  }
  if (
    hasExplicitMarketTicker(question) &&
    hasMarketDataLanguage
  ) {
    return {
      version: ASK_NEST_INTENT_VERSION,
      intent: "market_data",
      recommendedTools: ["get_market_history"],
      needsHybridRetrieval: false,
      confidence: "HIGH",
    };
  }
  const normalized = normalizeAskNestQuestion(question);
  const matched = RULES.find((rule) => (
    (!rule.pagePaths || rule.pagePaths.includes(pagePath))
    && rule.patterns.some((pattern) => pattern.test(normalized))
  ));
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
    "/cio": "get_cio_overview",
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
  const toolHint = result.recommendedTools.length
    ? `Recommended first tool: ${result.recommendedTools.join(", ")}.`
    : "No read tool is recommended. Answer this conceptual question without workspace data, dates, percentages, or illustrative currency amounts.";
  const routingQualifier = result.recommendedTools.length
    ? "This is a deterministic hint, not evidence. Override it only when the user's wording or successful tool output clearly requires another read-only tool."
    : "This is deterministic routing guidance, not evidence. Call a read-only tool only if the user separately asks for workspace-specific financial facts.";
  return [
    `Router version: ${result.version}.`,
    `Likely intent: ${result.intent}.`,
    toolHint,
    result.needsHybridRetrieval
      ? "The question appears to require workspace knowledge retrieval."
      : "The question does not appear to require workspace knowledge retrieval.",
    routingQualifier,
  ].join(" ");
}
