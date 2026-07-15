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

export type AskNestAnswer = {
  answer: string;
  highlights: AskNestHighlight[];
  evidence: AskNestEvidence[];
  followUpQuestions: string[];
  scope: AskNestScope;
};

export type AskNestApiError = {
  error: string;
  code: string;
};
