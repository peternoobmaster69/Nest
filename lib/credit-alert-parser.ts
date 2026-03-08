type ParsedAlert = {
  transactionRef?: string;
  bankName?: string;
  cardLast4?: string;
  merchant?: string;
  currency?: string;
  amountCents?: number;
  transactionDate?: Date;
};

const MONTH_INDEX: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

function parseAmountToCents(value: string) {
  const normalized = value.replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

function parseDateTime(rawBody: string) {
  const dtMatch = rawBody.match(/Date\s*&\s*Time:\s*(\d{2})\s+([A-Z]{3})\s+(\d{2}):(\d{2})/i);
  if (!dtMatch) return undefined;

  const [, dayRaw, monRaw, hhRaw, mmRaw] = dtMatch;
  const day = Number(dayRaw);
  const monthIndex = MONTH_INDEX[monRaw.toUpperCase()];
  const hour = Number(hhRaw);
  const minute = Number(mmRaw);
  if (monthIndex === undefined) return undefined;

  // Prefer explicit request date year, fallback to current year.
  const datedMatch = rawBody.match(/request dated\s*(\d{2})\/(\d{2})\/(\d{2})/i);
  const year = datedMatch ? 2000 + Number(datedMatch[3]) : new Date().getUTCFullYear();

  // SGT timestamp in source email.
  const utcMillis = Date.UTC(year, monthIndex, day, hour - 8, minute, 0);
  return new Date(utcMillis);
}

export function parseDbsTransactionAlert(rawBody: string): ParsedAlert {
  const transactionRef = rawBody.match(/Transaction Ref:\s*([A-Z0-9]+)/i)?.[1];
  const amountMatch = rawBody.match(/Amount:\s*([A-Z]{3})\s*([0-9,]+\.[0-9]{2})/i);
  const fromLine = rawBody.match(/From:\s*([^\n\r]+)/i)?.[1] ?? "";
  const bankName = fromLine.match(/^([A-Z/ ]+?)\s+card/i)?.[1]?.trim();
  const cardLast4 = rawBody.match(/card ending\s*(\d{4})/i)?.[1];
  const merchant = rawBody.match(/To:\s*([^\n\r]+)/i)?.[1]?.trim();
  const currency = amountMatch?.[1]?.toUpperCase();
  const amountCents = amountMatch?.[2] ? parseAmountToCents(amountMatch[2]) : undefined;
  const transactionDate = parseDateTime(rawBody);

  return {
    transactionRef,
    bankName,
    cardLast4,
    merchant,
    currency,
    amountCents,
    transactionDate,
  };
}

