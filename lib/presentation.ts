function formatLocalDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-SG", options || { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatLocalDateTime(value: Date | string | number) {
  return formatLocalDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
