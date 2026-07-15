import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { answerAskNest, AskNestResponseError } from "@/lib/ai/ask-nest";
import { AiConfigurationError } from "@/lib/ai/config";
import { consumeAskNestRateLimit } from "@/lib/ai/rate-limit";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(1_600),
}).strict();

const AskNestRequestSchema = z.object({
  question: z.string().trim().min(2).max(600),
  pagePath: z.string().trim().regex(/^\/[A-Za-z0-9/_-]*$/).max(120),
  history: z.array(HistoryMessageSchema).max(6).default([]),
}).strict().superRefine((value, context) => {
  const historyLength = value.history.reduce((sum, message) => sum + message.content.length, 0);
  if (historyLength > 6_000) {
    context.addIssue({
      code: "custom",
      path: ["history"],
      message: "Conversation context is too long.",
    });
  }
});

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/accounts": "Accounts",
  "/budgets": "Budgets",
  "/budgets/plan": "Budget Plan",
  "/collaborators": "Workspaces",
  "/credit-alerts": "Credit Alert Staging",
  "/credit-cards": "Credit Cards",
  "/credit-transactions": "Credit Card Transactions",
  "/investments": "Investments",
  "/receivables": "Receivables",
  "/rewards": "Rewards",
  "/settings": "Settings",
  "/transactions": "Transactions",
};

function errorResponse(error: string, code: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json(
    { error, code },
    { status, headers: { ...PRIVATE_HEADERS, ...headers } },
  );
}

export async function POST(request: Request) {
  try {
    const { userId, workspaceId } = await requireWorkspaceAccess();
    const body = await request.json().catch(() => null);
    const parsed = AskNestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("Ask Nest needs a shorter, valid question.", "AI_INVALID_REQUEST", 400);
    }

    const rateLimit = consumeAskNestRateLimit(userId);
    if (!rateLimit.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1_000));
      return errorResponse(
        "Ask Nest has reached its short-term request limit. Try again shortly.",
        "AI_RATE_LIMITED",
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    const answer = await answerAskNest({
      workspaceId,
      userId,
      question: parsed.data.question,
      pageTitle: PAGE_TITLES[parsed.data.pagePath] ?? "Nest",
      pagePath: parsed.data.pagePath,
      history: parsed.data.history,
    });
    return NextResponse.json(answer, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return errorResponse(error.message, "AI_UNAUTHORIZED", error.status);
    }
    if (error instanceof AiConfigurationError) {
      return errorResponse(
        "Ask Nest is not configured yet. Add the Azure AI workload settings and restart the app.",
        "AI_NOT_CONFIGURED",
        503,
      );
    }
    if (error instanceof AuthenticationError) {
      return errorResponse("Ask Nest could not authenticate with Azure AI.", "AI_AUTH_FAILED", 503);
    }
    if (error instanceof RateLimitError) {
      return errorResponse("Azure AI is busy right now. Try again shortly.", "AI_PROVIDER_RATE_LIMITED", 429);
    }
    if (error instanceof APIConnectionTimeoutError) {
      return errorResponse("Ask Nest took too long to respond. Try again.", "AI_TIMEOUT", 504);
    }
    if (error instanceof APIConnectionError) {
      return errorResponse("Ask Nest cannot reach Azure AI right now.", "AI_UNAVAILABLE", 503);
    }
    if (error instanceof AskNestResponseError) {
      return errorResponse("Ask Nest could not produce a grounded answer. Try rephrasing the question.", "AI_INVALID_RESPONSE", 502);
    }
    if (error instanceof APIError) {
      console.error("Ask Nest Azure API error", {
        name: error.name,
        status: error.status,
        code: error.code,
        param: error.param,
        requestId: error.requestID,
      });
      return errorResponse("Azure AI could not process this question.", "AI_PROVIDER_ERROR", 502);
    }

    console.error("Ask Nest request failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return errorResponse("Ask Nest could not answer right now.", "AI_INTERNAL_ERROR", 500);
  }
}
