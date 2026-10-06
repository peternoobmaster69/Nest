export function countSourceLines(source) {
  if (source.length === 0) return 0;
  return source.split(/\r?\n/).length - Number(source.endsWith("\n"));
}
