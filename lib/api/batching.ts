export const SQL_SERVER_SAFE_BATCH_SIZE = 50;

export function chunkValues<T>(values: readonly T[], size = SQL_SERVER_SAFE_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > 500) {
    throw new RangeError("Batch size must be an integer between 1 and 500");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

