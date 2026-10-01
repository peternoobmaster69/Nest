import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { answerAskNest, AskNestResponseError } from "@/lib/ai/ask-nest";
import { AskNestRequestSchema } from "@/lib/ai/ask-nest-contracts";
import { AiConfigurationError } from "@/lib/ai/config";
import { consumeAskNestRateLimit } from "@/lib/ai/rate-limit";
import { AgentPolicyError } from "@/lib/ai/agent-policy";
import { prisma } from "@/lib/prisma";
import { saveAskNestMemories } from "@/lib/ai/memory";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/budgets": "Budgets",
  "/budgets/plan": "Budget Plan",
  "/collaborators": "Workspaces",
  "/credit-alerts": "Credit Alert Staging",
  "/credit-cards": "Credit Cards",
  "/credit-transactions": "Credit Card Transactions",
  "/cio": "Nest CIO",
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
    await enforceDistributedRateLimit(request, {
      scope: "ask-nest",
      identifier: `${workspaceId}:${userId}`,
      limit: 20,
      windowMs: 10 * 60_000,
      blockMs: 10 * 60_000,
    });
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

    const turnId = randomUUID();
    const result = await answerAskNest({
      workspaceId,
      userId,
      question: parsed.data.question,
      pageTitle: PAGE_TITLES[parsed.data.pagePath] ?? "Nest",
      pagePath: parsed.data.pagePath,
      history: parsed.data.history,
    });
    const answer = result.answer;
    answer.turnId = turnId;
    try {
      await prisma.askNestTurn.create({
        data: {
          id: turnId,
          workspaceId,
          userId,
          question: parsed.data.question,
          answerJson: JSON.stringify(answer),
          pagePath: parsed.data.pagePath,
          inputTokens: result.tokenUsage?.inputTokens,
          outputTokens: result.tokenUsage?.outputTokens,
          totalTokens: result.tokenUsage?.totalTokens,
          diagnosticsJson: JSON.stringify(result.diagnostics),
          toolCallCount: result.diagnostics.toolCallCount,
          emptyResultCount: result.diagnostics.emptyResultCount,
          durationMs: result.diagnostics.durationMs,
        },
      });
      const memoryUpdates = await saveAskNestMemories({
        workspaceId,
        userId,
        sourceTurnId: turnId,
        question: parsed.data.question,
        candidates: result.memoryCandidates,
      });
      if (memoryUpdates.length) {
        answer.memoryUpdates = memoryUpdates;
        await prisma.askNestTurn.update({
          where: { id: turnId },
          data: { answerJson: JSON.stringify(answer) },
        });
      }
    } catch (historyError) {
      console.error("Ask Nest history save failed", {
        name: historyError instanceof Error ? historyError.name : "UnknownError",
      });
    }
    return NextResponse.json(answer, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof AgentPolicyError) return errorResponse(error.message, "AI_AGENT_DISABLED", error.status);
    const limited = rateLimitResponse(error);
    if (limited) return limited;
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
      console.warn("Ask Nest response rejected", { code: error.code });
      return errorResponse(error.publicMessage, error.code, error.status);
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
