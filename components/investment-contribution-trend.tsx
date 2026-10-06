export function ContributionTrendIndicator({
  currentCents,
  previousCents,
  previousYear,
}: Readonly<{
  currentCents: number;
  previousCents: number | undefined;
  previousYear: number;
}>) {
  if (previousCents === undefined || currentCents === previousCents) return null;
  const increased = currentCents > previousCents;
  return (
    <span
      className={`inv-contribution-trend ${increased ? "is-up" : "is-down"}`}
      role="img"
      aria-label={`${increased ? "Increased" : "Decreased"} from ${previousYear}`}
      title={`${increased ? "Increased" : "Decreased"} from ${previousYear}`}
    >
      {increased ? "▲" : "▼"}
    </span>
  );
}
