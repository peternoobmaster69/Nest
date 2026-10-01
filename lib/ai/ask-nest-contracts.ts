import { z } from "zod";

export const ASK_NEST_ANSWER_MAX_LENGTH = 6_000;
export const ASK_NEST_QUESTION_MAX_LENGTH = 600;
const HISTORY_TURN_LIMIT = 3;
export const ASK_NEST_HISTORY_MAX_LENGTH = HISTORY_TURN_LIMIT * (ASK_NEST_QUESTION_MAX_LENGTH + ASK_NEST_ANSWER_MAX_LENGTH);

const HistoryMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(ASK_NEST_QUESTION_MAX_LENGTH) }).strict(),
  z.object({ role: z.literal("assistant"), content: z.string().trim().min(1).max(ASK_NEST_ANSWER_MAX_LENGTH) }).strict(),
]);

export const AskNestRequestSchema = z.object({
  question: z.string().trim().min(2).max(ASK_NEST_QUESTION_MAX_LENGTH),
  pagePath: z.string().trim().regex(/^\/[A-Za-z0-9/_-]*$/).max(120),
  history: z.array(HistoryMessageSchema).max(HISTORY_TURN_LIMIT * 2).default([]),
}).strict().superRefine((value, context) => {
  if (value.history.reduce((sum, message) => sum + message.content.length, 0) > ASK_NEST_HISTORY_MAX_LENGTH) {
    context.addIssue({ code: "custom", path: ["history"], message: "Conversation context is too long." });
  }
});
