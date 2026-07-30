export const STALE_WRITE_CODE = "STALE_WRITE";

export function staleWriteResponse(currentUpdatedAt?: Date | string | null) {
  const value = currentUpdatedAt instanceof Date ? currentUpdatedAt.toISOString() : currentUpdatedAt ?? null;
  return Response.json({
    error: "This record changed after you opened it. Reload the latest version before saving.",
    code: STALE_WRITE_CODE,
    currentUpdatedAt: value,
  }, { status: 412 });
}

