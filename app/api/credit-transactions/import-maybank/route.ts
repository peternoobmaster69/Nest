import { NextResponse } from "next/server";
import { ApiRequestError, parseJsonBody, runSecureApiRoute } from "@/lib/api-security";
import { enforceDistributedRateLimit } from "@/lib/security-rate-limit";
import { getIdempotencyKey, PostingConflictError } from "@/lib/domains/ledger";
import { ImportMaybankSchema } from "@/lib/domains/integrations/import-contracts";
import { importMaybankChunk } from "@/lib/domains/integrations/maybank-import-service";

export async function POST(request: Request) {
  // runSecureApiRoute performs the equivalent of requireWorkspaceAccess(null, "EDITOR").
  return runSecureApiRoute(
    request,
    {
      mutation: true,
      auth: { minimumRole: "EDITOR" },
      errorMessage: "Failed to import Maybank CSV",
    },
    async ({ auth }) => {
      await enforceDistributedRateLimit(request, {
        scope: "maybank-csv-import",
        identifier: `${auth!.workspaceId}:${auth!.userId}`,
        limit: 6,
        windowMs: 10 * 60_000,
        blockMs: 10 * 60_000,
      });
      const input = await parseJsonBody(request, ImportMaybankSchema, 600 * 1024);
      const fallbackKey = input.importRunId
        ? `maybank:${input.importRunId}:${input.chunkIndex}`
        : undefined;
      try {
        const result = await importMaybankChunk({
          workspaceId: auth!.workspaceId,
          userId: auth!.userId,
          input,
          idempotencyKey: getIdempotencyKey(request, fallbackKey),
        });
        return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
      } catch (error) {
        if (error instanceof PostingConflictError) {
          throw new ApiRequestError(409, error.message);
        }
        throw error;
      }
    },
  );
}
