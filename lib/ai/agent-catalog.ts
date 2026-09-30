export const AGENT_IDS = ["ask-nest", "transaction-assistant", "smart-review"] as const;
export type AgentId = typeof AGENT_IDS[number];
export type AgentReasoningEffort = "default" | "low" | "medium" | "high";

export type AgentSettings = {
  enabled: boolean;
  instructions: string;
  deployment: string | null;
  reasoningEffort: AgentReasoningEffort;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxToolCalls: number;
  trainingExampleLimit: number;
  capabilities: string[];
};

export type AgentConfiguration = AgentSettings & {
  id: AgentId;
  revision: number;
  updatedAt: string | null;
};

export type AgentCapability = {
  id: string;
  name: string;
  description: string;
  tools?: readonly string[];
};

export type AgentDefinition = {
  id: AgentId;
  name: string;
  description: string;
  surface: string;
  guardrails: readonly string[];
  capabilities: readonly AgentCapability[];
  defaults: Omit<AgentSettings, "capabilities">;
};

const sharedDefaults = {
  enabled: true,
  deployment: null,
  reasoningEffort: "default" as const,
  maxToolRounds: 8,
  maxToolCalls: 16,
  trainingExampleLimit: 4,
};

export const AGENT_CATALOG: readonly AgentDefinition[] = [
  {
    id: "ask-nest",
    name: "Ask Nest",
    description: "Answers financial questions, investigates changes, and explains what to do next using verified workspace data.",
    surface: "Ask Nest · every workspace",
    guardrails: ["Reads only the active workspace", "Verifies financial figures against evidence", "Cannot change financial records"],
    defaults: {
      ...sharedDefaults,
      maxOutputTokens: 4_000,
      instructions: "Investigate the user's underlying question. For comparisons, check the relevant periods and explain the largest supported drivers. Use the available tools to resolve uncertainty before asking the user. State missing evidence plainly and offer a useful next action.",
    },
    capabilities: [
      { id: "cash-flow", name: "Cash flow and spending", description: "Investigate income, spending, transactions, categories, and trips.", tools: ["get_financial_snapshot", "compare_spending", "get_category_spending", "find_transactions", "get_spending_breakdown", "get_trip_spending", "explain_cash_flow_change", "compare_income", "get_top_spending_drivers", "find_recurring_spend"] },
      { id: "budgets", name: "Budgets and reconciliation", description: "Compare budgets with actual spending and explain bank reconciliation.", tools: ["get_budget_plan", "get_budget_vs_actual", "explain_reconciliation"] },
      { id: "cards", name: "Credit cards", description: "Find card transactions and explain outstanding statements.", tools: ["find_card_transactions", "get_card_obligations"] },
      { id: "receivables", name: "Receivables", description: "Explain outstanding reimbursements and money owed.", tools: ["get_receivables"] },
      { id: "investments", name: "Investments and CIO", description: "Review investments, policy, strategy, and retirement scenarios.", tools: ["get_investment_summary", "get_cio_overview", "get_cio_policy_status", "get_cio_strategy_recommendations", "run_cio_retirement_projection", "compare_cio_contribution_scenarios"] },
      { id: "market-data", name: "Market history", description: "Use configured market data to explain historical prices.", tools: ["get_market_history"] },
      { id: "public-research", name: "Financial research", description: "Consult configured public news and authoritative financial sources.", tools: ["search_market_news", "search_public_financial_sources", "read_authoritative_financial_source"] },
      { id: "knowledge", name: "Workspace knowledge", description: "Search workspace notes when knowledge search is connected.", tools: ["search_workspace_knowledge"] },
      { id: "memory", name: "Personal preferences", description: "Remember explicit preferences and use relevant conversation context." },
    ],
  },
  {
    id: "transaction-assistant",
    name: "Transaction assistant",
    description: "Turns natural language into transaction drafts, resolves accounts, and prepares corrections for review.",
    surface: "Ask Nest · transaction entry",
    guardrails: ["An editor reviews and confirms every write", "Never invents amounts or accounts", "Corrections preserve the original history"],
    defaults: {
      ...sharedDefaults,
      maxOutputTokens: 3_200,
      instructions: "Understand informal wording and local merchant terminology. Preserve all details already supplied, distinguish corrections from new transactions, and ask only for information that is still missing or ambiguous.",
    },
    capabilities: [
      { id: "create-transactions", name: "Create transaction drafts", description: "Prepare new income and expense entries for confirmation." },
      { id: "correct-transactions", name: "Correct transactions", description: "Prepare traceable corrections to existing entries." },
      { id: "account-suggestions", name: "Suggest matching accounts", description: "Use the model to suggest existing sub-accounts from natural language." },
    ],
  },
  {
    id: "smart-review",
    name: "Smart Review",
    description: "Reviews card transactions using accounting history, merchant understanding, and model-assisted suggestions.",
    surface: "Credit card transactions · Smart Review",
    guardrails: ["Suggestions require human review", "Duplicate and reversal checks stay active", "Only existing accounting destinations are allowed"],
    defaults: {
      ...sharedDefaults,
      maxOutputTokens: 4_000,
      instructions: "Use merchant context carefully. Prefer no reliable match to an unsupported category. Distinguish reimbursable or shared spending from an ordinary purchase and preserve meaningful merchant names.",
    },
    capabilities: [
      { id: "merchant-names", name: "Merchant names", description: "Recommend clearer merchant descriptions." },
      { id: "account-recommendations", name: "Accounting suggestions", description: "Recommend matching sub-accounts from approved history and merchant context." },
      { id: "receivable-recommendations", name: "Reimbursement suggestions", description: "Identify transactions that may need a receivable." },
      { id: "rule-suggestions", name: "Rule suggestions", description: "Suggest accounting rules supported by repeated approved history." },
    ],
  },
];

export function getAgentDefinition(id: string): AgentDefinition {
  const definition = AGENT_CATALOG.find((agent) => agent.id === id);
  if (!definition) throw new Error("Unknown agent.");
  return definition;
}

export function defaultAgentConfiguration(id: AgentId): AgentConfiguration {
  const definition = getAgentDefinition(id);
  return {
    ...definition.defaults,
    id,
    capabilities: definition.capabilities.map((capability) => capability.id),
    revision: 0,
    updatedAt: null,
  };
}

export function enabledAgentTools(configuration: AgentConfiguration): Set<string> {
  return new Set(getAgentDefinition(configuration.id).capabilities
    .filter((capability) => configuration.capabilities.includes(capability.id))
    .flatMap((capability) => capability.tools ?? []));
}
