export type SmartReviewConfidence = "STRONG_MATCH" | "NEEDS_REVIEW" | "NO_RELIABLE_MATCH";

export type SmartReviewState =
  | "UNACCOUNTED"
  | "POSSIBLE_DUPLICATE"
  | "POSSIBLE_REVERSAL";

export type SmartReviewDeductAction = {
  type: "DEDUCT";
  accountId: string;
  accountName: string;
  budgetId: string;
  budgetName: string;
  destinationAccountId?: string;
  destinationAccountName?: string;
  destinationBudgetId?: string;
  destinationBudgetName?: string;
};

export type SmartReviewReceivableAction = {
  type: "RECEIVABLE";
  sourceWorkspaceId?: string;
  sourceWorkspaceName?: string;
  accountId?: string;
  accountName?: string;
  budgetId?: string;
  budgetName?: string;
};

export type SmartReviewAction = SmartReviewDeductAction | SmartReviewReceivableAction;

export type SmartReviewCurrentAccounting = {
  type: "DEDUCT" | "RECEIVABLE" | "MARKED_ACCOUNTED";
  label: string;
  ledgerTransactionId?: string;
  action?: SmartReviewAction;
};

export type SmartReviewRelatedTransaction = {
  id: string;
  subject: string;
  transactionDate: string;
  isAllocated: boolean;
};

export type SmartReviewRuleDraft = {
  name: string;
  filter: string;
  sourceBudgetId: string;
  destinationBudgetId: string;
  recentMatchCount: number;
  previewSubjects: string[];
};

export type SmartReviewSuggestion = {
  transactionId: string;
  inputFingerprint: string;
  generatedAt: string;
  normalizedMerchant: string;
  nameRecommendation: string | null;
  confidence: SmartReviewConfidence;
  state: SmartReviewState;
  action: SmartReviewAction | null;
  evidence: string[];
  supportingCount: number;
  matchedRuleName?: string;
  relatedTransaction?: SmartReviewRelatedTransaction;
  canApprove: boolean;
  generatedBy: "DETERMINISTIC" | "AI_ASSISTED";
  ruleDraft?: SmartReviewRuleDraft;
};

export type SmartReviewResponse = {
  suggestions: SmartReviewSuggestion[];
  providerStatus: "READY" | "PARTIAL" | "UNAVAILABLE" | "NOT_NEEDED";
  generatedAt: string;
};
