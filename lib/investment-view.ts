export type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
};

export type InvestmentEntry = {
  id: string;
  date: string;
  investedCents: number;
  currentValueCents: number;
  createdAt: string;
  updatedAt: string;
};

export type InvestmentAccount = {
  id: string;
  displayName?: string | null;
  institutionName: string;
  productName: string;
  inceptionDate: string;
  divestedDate?: string | null;
  isLiquid: boolean;
  entries: InvestmentEntry[];
};

export type TimeRange = "90D" | "180D" | "1Y" | "ALL";

export type InvestmentChartPoint = {
  id: string;
  x: number;
  yInvested: number;
  yCurrent: number;
  label: string;
  invested: number;
  current: number;
};

export function toIsoFromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

export function dateInputFromIso(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function isWithinLastDay(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp < 24 * 60 * 60 * 1000;
}

export function formatInceptionBadge(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = String(date.getFullYear());
  return {
    full: `Since ${year}`,
    compact: `Since ’${year.slice(-2)}`,
  };
}

export function buildLinePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const [first, ...rest] = points;
  return rest.reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${first.x} ${first.y}`);
}

export function buildAreaPath(points: Array<{ x: number; y: number }>, baselineY: number) {
  if (!points.length) return "";
  const linePath = buildLinePath(points);
  const first = points[0];
  const last = points.at(-1)!;
  return `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

