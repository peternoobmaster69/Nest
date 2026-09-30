import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assertSameOriginRequest, parseJsonBody, ApiRequestError } from "@/lib/api-security";
import { ApiAuthError, requireWorkspaceAccess } from "@/lib/workspace-auth";
import { enforceDistributedRateLimit, rateLimitResponse } from "@/lib/security-rate-limit";
import { PostingConflictError } from "@/lib/domains/ledger";
import { TransactionAgentRequestSchema } from "@/lib/ai/transaction-agent-contracts";
import { AgentPolicyError } from "@/lib/ai/agent-policy";
import { advanceTransactionAgent, confirmTransactionAgent, getTransactionAgentDraft, transactionAgentView } from "@/lib/ai/transaction-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, X-Workspace-Id" };

function failure(error: unknown) {
  if (error instanceof AgentPolicyError) return NextResponse.json({ error: error.message, code: "AI_AGENT_DISABLED" }, { status: error.status, headers });
  const limited = rateLimitResponse(error);
  if (limited) {
    Object.entries(headers).forEach(([key, value]) => limited.headers.set(key, value));
    return limited;
  }
  if (error instanceof ApiAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ApiRequestError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: "Please send a valid transaction request (up to 600 characters)." }, { status: 400, headers });
  if (error instanceof PostingConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers });
  console.error("Transaction assistant failed", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "The transaction assistant is unavailable. Reload the draft to check its status before trying again." }, { status: 500, headers });
}

export async function GET(request: Request) {
  try {
    const scope = await requireWorkspaceAccess(undefined, "EDITOR");
    const id = new URL(request.url).searchParams.get("draftId");
    if (!id || id.length > 191) return NextResponse.json({ error: "A valid draft ID is required." }, { status: 400, headers });
    return NextResponse.json(transactionAgentView(await getTransactionAgentDraft(scope, id)), { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const scope = await requireWorkspaceAccess(undefined, "EDITOR");
    assertSameOriginRequest(request);
    const input = await parseJsonBody(request, TransactionAgentRequestSchema, 8_192);
    // Cancellation and confirmation do not consume the model-call allowance. Inline edits never call the model.
    if (["start", "message", "select"].includes(input.action)) await enforceDistributedRateLimit(request, {
      scope: "transaction-agent", identifier: `${scope.workspaceId}:${scope.userId}`, limit: 40, windowMs: 10 * 60_000,
    });
    if (input.action === "edit") await enforceDistributedRateLimit(request, {
      scope: "transaction-agent-edit", identifier: `${scope.workspaceId}:${scope.userId}`, limit: 120, windowMs: 10 * 60_000,
    });
    const result = input.action === "confirm"
      ? await confirmTransactionAgent(scope, input)
      : await advanceTransactionAgent(scope, input);
    return NextResponse.json(result, { headers });
  } catch (error) { return failure(error); }
}
