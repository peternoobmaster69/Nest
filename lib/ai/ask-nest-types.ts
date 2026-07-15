export type AskNestHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AskNestHighlight = {
  label: string;
  value: string;
  tone: "neutral" | "positive" | "warning";
};

export type AskNestEvidence = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type AskNestScope = {
  workspaceName: string;
  currency: string;
  asOf: string;
  pageTitle: string;
  toolsUsed: string[];
};

export type AskNestVisualization =
  | {
      type: "trip_cards";
      title: string;
      disclaimer?: string;
      items: Array<{
        label: string;
        flag: string;
        amount: string;
        dateRange: string;
        href: string;
      }>;
    }
  | {
      type: "trend_chart";
      title: string;
      currency: string;
      points: Array<{ label: string; valueCents: number; formattedValue: string }>;
    }
  | {
      type: "investment_chart";
      title: string;
      currency: string;
      items: Array<{
        label: string;
        investedCents: number;
        currentValueCents: number;
        invested: string;
        currentValue: string;
      }>;
    };

export type AskNestAnswer = {
  answer: string;
  highlights: AskNestHighlight[];
  evidence: AskNestEvidence[];
  followUpQuestions: string[];
  visualization?: AskNestVisualization;
  memoryUpdates?: string[];
  scope: AskNestScope;
};

export type AskNestApiError = {
  error: string;
  code: string;
};
