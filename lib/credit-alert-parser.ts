export type ParsedAlert = {
  transactionRef?: string;
  bankName?: string;
  cardLast4?: string;
  merchant?: string;
  currency?: string;
  amountCents?: number;
  transactionDate?: Date;
  alertType?: "PURCHASE" | "REVERSAL";
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

// Bank template matches validate the date and clock shapes before these conversions.
function parseDateAtUtcMidnight(rawDate: string) {
  const [ddRaw, mmRaw, yyRaw] = rawDate.split("/");
  const year = 2000 + Number(yyRaw);
  const monthIndex = Number(mmRaw) - 1;
  const day = Number(ddRaw);
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0));
}

function parseUobReversalDate(rawDate: string) {
  const [calendar, clock] = rawDate.split(",");
  const [dayRaw, monRaw, yyRaw] = calendar.split(/\s+/);
  const [hhRaw, minuteWithMeridiem] = clock.trim().split(":");
  const day = Number(dayRaw);
  const monthIndex = MONTH_INDEX[monRaw.toUpperCase()];
  const year = 2000 + Number(yyRaw);
  let hour = Number(hhRaw);
  const minute = Number(minuteWithMeridiem.slice(0, 2));
  const meridiem = minuteWithMeridiem.slice(2).toUpperCase();
  if (monthIndex === undefined) return undefined;
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, monthIndex, day, hour - 8, minute, 0));
}

function parseOcbcDateTime(rawTime: string, rawDate: string) {
  const [hhRaw, mmRaw] = rawTime.split(":");
  const [dayRaw, monRaw, yyRaw] = rawDate.split("-");
  const day = Number(dayRaw);
  const monthIndex = MONTH_INDEX[monRaw.toUpperCase()];
  const year = 2000 + Number(yyRaw);
  const hour = Number(hhRaw);
  const minute = Number(mmRaw);
  if (monthIndex === undefined) return undefined;

  return new Date(Date.UTC(year, monthIndex, day, hour - 8, minute, 0));
}

function parseDateAndTime(rawDate: string, rawTime: string) {
  const [ddRaw, mmRaw, yyRaw] = rawDate.split("/");
  const [hhRaw, minRaw, secRaw] = rawTime.split(":");
  const year = 2000 + Number(yyRaw);
  const monthIndex = Number(mmRaw) - 1;
  const day = Number(ddRaw);
  const hour = Number(hhRaw);
  const minute = Number(minRaw);
  const second = Number(secRaw);
  return new Date(Date.UTC(year, monthIndex, day, hour - 8, minute, second));
}

function parseDateTime(rawBody: string) {
  const dtMatch = /Date\s*&\s*Time:\s*(\d{2})\s+([A-Z]{3})\s+(\d{2}):(\d{2})/i.exec(rawBody);
  if (!dtMatch) return undefined;

  const [, dayRaw, monRaw, hhRaw, mmRaw] = dtMatch;
  const day = Number(dayRaw);
  const monthIndex = MONTH_INDEX[monRaw.toUpperCase()];
  const hour = Number(hhRaw);
  const minute = Number(mmRaw);
  if (monthIndex === undefined) return undefined;

  // Prefer explicit request date year, fallback to current year.
  const datedMatch = /request dated\s*(\d{2})\/(\d{2})\/(\d{2})/i.exec(rawBody);
  const year = datedMatch ? 2000 + Number(datedMatch[3]) : new Date().getUTCFullYear();

  // SGT timestamp in source email.
  const utcMillis = Date.UTC(year, monthIndex, day, hour - 8, minute, 0);
  return new Date(utcMillis);
}

function parseBankName(fromLine: string) {
  const card = /(?<=\s)card/i.exec(fromLine);
  if (!card) return undefined;
  const name = fromLine.slice(0, card.index).trim();
  return /^[A-Z/ ]+$/i.test(name) ? name : undefined;
}

function parseDbsTransactionAlert(rawBody: string): ParsedAlert {
  const transactionRef = /Transaction Ref:\s*([A-Z0-9]+)/i.exec(rawBody)?.[1];
  const amountMatch = /Amount:\s*([A-Z]{3})\s*([\d,]+\.\d{2})/i.exec(rawBody);
  const fromLine = /From:\s*([^\n\r]+)/i.exec(rawBody)?.[1] ?? "";
  const bankName = parseBankName(fromLine);
  const cardLast4 = /card ending\s*(\d{4})/i.exec(rawBody)?.[1];
  const merchant = /To:\s*([^\n\r]+)/i.exec(rawBody)?.[1]?.trim();
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
    alertType: "PURCHASE",
  };
}

function readAlertFields(body: string, patterns: RegExp[]) {
  const fields: string[] = [];
  let remaining = body;
  for (const pattern of patterns) {
    const match = pattern.exec(remaining);
    if (!match) return null;
    fields.push(...match.slice(1));
    remaining = remaining.slice(match.index + match[0].length);
  }
  return { fields, remaining };
}

function parseMerchant(value: string) {
  const merchant = value.trim();
  if (!merchant || /[\r\n\u2028\u2029]/.test(merchant)) return undefined;
  return merchant;
}

function parseUobTransit(rawBody: string): ParsedAlert | null {
  const match = readAlertFields(rawBody, [
    /Your accumulated transit transactions of\s+([A-Z]{3})\s*([\d,]+\.\d{2})/i,
    /^\s+has been billed to your UOB card ending\s*(\d{4})\s+on\s+(\d{2}\/\d{2}\/\d{2})/i,
  ]);
  if (!match) return null;
  const [currency, amountRaw, cardLast4, dateRaw] = match.fields;
  return {
    bankName: "UOB", cardLast4, merchant: "Transit charges", currency: currency.toUpperCase(),
    amountCents: parseAmountToCents(amountRaw), transactionDate: parseDateAtUtcMidnight(dateRaw), alertType: "PURCHASE",
  };
}

function parseUobReversal(rawBody: string): ParsedAlert | null {
  const match = readAlertFields(rawBody, [
    /A transaction of\s+([\d,]+\.\d{2})\s+([A-Z]{3})/i,
    /^\s+made with your UOB card ending\s*(\d{4})\s+on\s+/i,
    /^(\d{2}\s+[A-Z]{3}\s+\d{2},\s*\d{1,2}:\d{2}(?:AM|PM))\s+at\s+/i,
  ]);
  if (!match) return null;
  const ending = /(?<=\s)has been reversed\./i.exec(match.remaining);
  if (!ending) return null;
  const merchant = parseMerchant(match.remaining.slice(0, ending.index));
  if (!merchant) return null;
  const [amountRaw, currency, cardLast4, dateRaw] = match.fields;
  return {
    bankName: "UOB", cardLast4, merchant, currency: currency.toUpperCase(),
    amountCents: parseAmountToCents(amountRaw), transactionDate: parseUobReversalDate(dateRaw), alertType: "REVERSAL",
  };
}

function parseUobPurchase(rawBody: string): ParsedAlert | null {
  const match = readAlertFields(rawBody, [
    /A transaction of\s+([A-Z]{3})\s*([\d,]+\.\d{2})/i,
    /^\s+was made with your UOB Card ending\s*(\d{4})\s+on\s+(\d{2}\/\d{2}\/\d{2})\s+at\s+/i,
  ]);
  if (!match) return null;
  const ending = /\.\s+If unauthorised/i.exec(match.remaining);
  const merchant = parseMerchant(ending ? match.remaining.slice(0, ending.index) : match.remaining);
  if (!merchant) return null;
  const [currency, amountRaw, cardLast4, dateRaw] = match.fields;
  return {
    bankName: "UOB", cardLast4, merchant, currency: currency.toUpperCase(),
    amountCents: parseAmountToCents(amountRaw), transactionDate: parseDateAtUtcMidnight(dateRaw), alertType: "PURCHASE",
  };
}

function parseUobTransactionAlert(rawBody: string): ParsedAlert {
  return parseUobTransit(rawBody) ?? parseUobReversal(rawBody) ?? parseUobPurchase(rawBody) ?? { bankName: "UOB" };
}

function parseOcbcTransactionAlert(rawBody: string): ParsedAlert {
  const match = readAlertFields(rawBody, [
    /We wish to inform you that\s+([A-Z]{3})\s*([\d,]+\.\d{2})\s+was charged at\s+(\d{2}:\d{2})/i,
    /^\s+on\s+(\d{2}-[A-Z]{3}-\d{2})\s+to your card\s+\(-(\d{4})\)\s+at\s+/i,
  ]);
  if (!match) return { bankName: "OCBC Bank" };
  const merchant = parseMerchant(match.remaining.split(".", 1)[0]);
  if (!merchant) return { bankName: "OCBC Bank" };
  const [currency, amountRaw, timeRaw, dateRaw, cardLast4] = match.fields;
  return {
    bankName: "OCBC Bank",
    cardLast4,
    merchant,
    currency: currency.toUpperCase(),
    amountCents: parseAmountToCents(amountRaw),
    transactionDate: parseOcbcDateTime(timeRaw, dateRaw),
    alertType: "PURCHASE",
  };
}

function parseCitiTransactionAlert(rawBody: string): ParsedAlert {
  const cardLast4 = /Account\s+Number\s*:\s*X{4}-X{4}-X{4}-(\d{4})/i.exec(rawBody)?.[1];
  const dateRaw = /Transaction\s+date\s*:\s*(\d{2}\/\d{2}\/\d{2})/i.exec(rawBody)?.[1];
  const timeRaw = /Transaction\s+time\s*:\s*(\d{2}:\d{2}:\d{2})/i.exec(rawBody)?.[1];
  const amountMatch = /Transaction\s+amount\s*:\s*([A-Z]{3})\s*([\d,]+\.\d{2})/i.exec(rawBody);
  const merchant = /Transaction\s+details\s*:\s*([^\n\r]+)/i.exec(rawBody)?.[1]?.trim();

  return {
    bankName: "Citibank",
    cardLast4,
    merchant,
    currency: amountMatch?.[1]?.toUpperCase(),
    amountCents: amountMatch?.[2] ? parseAmountToCents(amountMatch[2]) : undefined,
    transactionDate: dateRaw && timeRaw ? parseDateAndTime(dateRaw, timeRaw) : undefined,
    alertType: "PURCHASE",
  };
}

export function parseCreditAlert(rawBody: string, rawSubject?: string): ParsedAlert {
  const subject = rawSubject?.toLowerCase() ?? "";
  const body = rawBody.toLowerCase();

  if (
    subject.includes("uob - transaction alert") ||
    subject.includes("your transaction has been reversed") ||
    body.includes("uob card ending") ||
    body.includes("your accumulated transit transactions")
  ) {
    return parseUobTransactionAlert(rawBody);
  }

  if (
    subject.includes("card transaction alert") &&
    body.includes("to your card (-")
  ) {
    return parseOcbcTransactionAlert(rawBody);
  }

  if (
    subject.includes("citi alerts - credit card/ready credit transaction") ||
    (body.includes("citibank") && body.includes("account number: xxxx-xxxx-xxxx-") && body.includes("transaction amount:"))
  ) {
    return parseCitiTransactionAlert(rawBody);
  }

  return parseDbsTransactionAlert(rawBody);
}
