import { z } from "zod";
import type { ListEnvelope } from "@/lib/api/contracts";
import { ApiRequestError } from "@/lib/api/contracts";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;
export const MAX_CURSOR_LENGTH = 512;

export type CursorValue = {
  id: string;
  sortValue: string;
};

function encodeCursor(value: CursorValue) {
  return Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString("base64url");
}

export function decodeCursor(value: string): CursorValue {
  if (value.length > MAX_CURSOR_LENGTH) throw new Error("Invalid cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.v !== 1 || typeof parsed.id !== "string" || typeof parsed.sortValue !== "string") {
      throw new Error("Invalid cursor");
    }
    return { id: parsed.id, sortValue: parsed.sortValue };
  } catch {
    throw new Error("Invalid cursor");
  }
}

export function parseListQuery(request: Request, defaults?: { defaultLimit?: number; maxLimit?: number }) {
  const params = new URL(request.url).searchParams;
  const maxLimit = defaults?.maxLimit ?? MAX_PAGE_SIZE;
  const parsed = z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaults?.defaultLimit ?? DEFAULT_PAGE_SIZE),
    cursor: z.string().trim().min(1).max(MAX_CURSOR_LENGTH).optional(),
    search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
  }).safeParse({
    limit: params.get("limit") || undefined,
    cursor: params.get("cursor") || undefined,
    search: params.get("search") || undefined,
  });
  if (!parsed.success) {
    throw new ApiRequestError(422, "Invalid pagination query", "UNPROCESSABLE_ENTITY");
  }
  return parsed.data;
}

export function toListEnvelope<T>(
  rows: T[],
  limit: number,
  cursorFor: (row: T) => CursorValue,
): ListEnvelope<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor: hasMore && items.length ? encodeCursor(cursorFor(items.at(-1)!)) : null,
      limit,
    },
  };
}
