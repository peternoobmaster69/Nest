const GENERAL_QUESTIONS = [
  "What needs my attention right now?",
  "How does this month's spending compare with last month?",
  "Which card payments are due next?",
];

export function suggestedQuestions(path: string) {
  if (path.startsWith("/transactions")) {
    return [
      "What are my largest expenses this month?",
      "How does this month's spending compare with last month?",
      "Show my recent unassigned transactions.",
    ];
  }
  if (path.startsWith("/credit-transactions") || path.startsWith("/credit-cards")) {
    return [
      "Which card payments are due next?",
      "How much is outstanding across my cards?",
      "Show recent unallocated card activity.",
    ];
  }
  if (path.startsWith("/receivables")) {
    return [
      "How much is still open in receivables?",
      "Show my largest open receivables.",
      "Which receivables were added this month?",
    ];
  }
  if (path.startsWith("/budgets")) {
    return [
      "Summarize this month's budget plan.",
      "Which sub-accounts have the lowest available balance?",
      "How much remains unallocated this month?",
    ];
  }
  if (path.startsWith("/investments")) {
    return [
      "Summarize my recorded investment values.",
      "Which investment accounts have a recorded gain or loss?",
      "How much of my recorded portfolio is liquid?",
    ];
  }
  return GENERAL_QUESTIONS;
}

