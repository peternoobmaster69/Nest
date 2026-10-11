import type { AskNestAnswer, AskNestApiError, AskNestFeedbackRating, AskNestFeedbackReason, AskNestHistoryMessage } from "@/lib/ai/ask-nest-types";

export type AskNestTurn = {
  id: string;
  question: string;
  answer?: AskNestAnswer;
  error?: string;
  errorCode?: string;
  pending?: boolean;
  createdAt?: string;
  feedbackRating?: AskNestFeedbackRating | null;
  feedbackReason?: AskNestFeedbackReason | null;
  feedbackPrompt?: boolean;
  feedbackPending?: boolean;
  feedbackError?: string;
};

export type AskNestHistoryPage = {
  turns: AskNestTurn[];
  nextCursor: string | null;
};

export type AskNestMemoryItem = {
  id: string;
  kind: "PREFERENCE" | "TERMINOLOGY" | "INSTRUCTION";
  key: string;
  content: string;
  confidence: number;
  sourceTurnId?: string | null;
  lastConfirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export class AskNestRequestError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AskNestRequestError";
    this.code = code;
  }
}

export const EDITABLE_ASK_NEST_ERRORS = new Set([
  "AI_LOOKUP_LIMIT",
  "AI_LOOKUP_ROUNDS_EXHAUSTED",
  "AI_INVALID_TOOL_FILTERS",
  "AI_NO_MATCHING_DATA",
  "AI_OUTPUT_LIMIT",
  "AI_CONTENT_FILTERED",
  "AI_UNGROUNDED_VALUE",
  "AI_AMBIGUOUS_CURRENCY",
]);

export const ASK_NEST_ERROR_LABELS: Record<string, string> = {
  AI_WORKSPACE_UNAVAILABLE: "Workspace unavailable",
  AI_LOOKUP_LIMIT: "Lookup limit reached",
  AI_LOOKUP_ROUNDS_EXHAUSTED: "Lookup planning did not finish",
  AI_INVALID_TOOL_FILTERS: "Invalid data filters",
  AI_DATA_TOOL_UNAVAILABLE: "Data source unavailable",
  AI_NO_MATCHING_DATA: "No matching records",
  AI_OUTPUT_LIMIT: "Answer exceeded the output limit",
  AI_CONTENT_FILTERED: "Response stopped by content safety",
  AI_MODEL_GENERATION_FAILED: "Azure AI generation failed",
  AI_EMPTY_RESPONSE: "No response from Azure AI",
  AI_INVALID_RESPONSE: "Response format could not be verified",
  AI_UNGROUNDED_VALUE: "Unsupported financial value blocked",
  AI_AMBIGUOUS_CURRENCY: "Currency could not be verified",
  AI_TIMEOUT: "Request timed out",
  AI_UNAVAILABLE: "Azure AI unavailable",
  AI_PROVIDER_RATE_LIMITED: "Azure AI is busy",
};

export function askNestErrorLabel(code?: string) {
  return code ? ASK_NEST_ERROR_LABELS[code] ?? "Ask Nest could not complete the request" : "Ask Nest could not complete the request";
}

export const RECORD_EXAMPLES = ["Deduct $10", "Spent $12.50 on lunch yesterday", "Change yesterday’s lunch to $12"];

export const NOT_USEFUL_REASONS: Array<{ value: AskNestFeedbackReason; label: string }> = [
  { value: "WRONG_DATA", label: "Wrong figures" },
  { value: "MISUNDERSTOOD", label: "Misunderstood" },
  { value: "MISSING_DETAIL", label: "Missing detail" },
  { value: "NO_RESULTS", label: "No useful results" },
  { value: "OTHER", label: "Other" },
];

export const NO_TURNS: AskNestTurn[] = [];

export function getHistory(turns: AskNestTurn[]): AskNestHistoryMessage[] {
  return turns
    .filter((turn): turn is AskNestTurn & { answer: AskNestAnswer } => Boolean(turn.answer))
    .slice(-3)
    .flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer.answer },
    ]);
}

export async function readAskNestAnswer(response: Response): Promise<AskNestAnswer> {
  const payload = await response.json().catch(() => null) as AskNestAnswer | AskNestApiError | null;
  if (response.ok && payload && !("error" in payload)) return payload;
  const error = payload && "error" in payload ? payload : null;
  throw new AskNestRequestError(error?.error ?? "Ask Nest could not answer right now.", error?.code ?? "AI_INTERNAL_ERROR");
}
