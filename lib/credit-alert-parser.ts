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

function parseDateAtUtcMidnight(rawDate: string) {
  const match = /(\d{2})\/(\d{2})\/(\d{2})/.exec(rawDate);
  if (!match) return undefined;
  const [, ddRaw, mmRaw, yyRaw] = match;
  const year = 2000 + Number(yyRaw);
  const monthIndex = Number(mmRaw) - 1;
  const day = Number(ddRaw);
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0));
}

function parseUobReversalDate(rawDate: string) {
  const match = /(\d{2})\s+([A-Z]{3})\s+(\d{2}),\s*(\d{1,2}):(\d{2})(AM|PM)/i.exec(rawDate);
  if (!match) return undefined;

  const [, dayRaw, monRaw, yyRaw, hhRaw, mmRaw, meridiemRaw] = match;
  const day = Number(dayRaw);
  const monthIndex = MONTH_INDEX[monRaw.toUpperCase()];
  const year = 2000 + Number(yyRaw);
  let hour = Number(hhRaw);
  const minute = Number(mmRaw);
  const meridiem = meridiemRaw.toUpperCase();
  if (monthIndex === undefined) return undefined;
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, monthIndex, day, hour - 8, minute, 0));
}

function parseOcbcDateTime(rawTime: string, rawDate: string) {
  const timeMatch = /(\d{2}):(\d{2})/.exec(rawTime);
  const dateMatch = /(\d{2})-([A-Z]{3})-(\d{2})/i.exec(rawDate);
  if (!timeMatch || !dateMatch) return undefined;

  const [, hhRaw, mmRaw] = timeMatch;
  const [, dayRaw, monRaw, yyRaw] = dateMatch;
  const day = Number(dayRaw);
  const monthIndex = MONTH_INDEX[monRaw.toUpperCase()];
  const year = 2000 + Number(yyRaw);
  const hour = Number(hhRaw);
  const minute = Number(mmRaw);
  if (monthIndex === undefined) return undefined;

  return new Date(Date.UTC(year, monthIndex, day, hour - 8, minute, 0));
}

function parseDateAndTime(rawDate: string, rawTime: string) {
  const dateMatch = /(\d{2})\/(\d{2})\/(\d{2})/.exec(rawDate);
  const timeMatch = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(rawTime);
  if (!dateMatch || !timeMatch) return undefined;

  const [, ddRaw, mmRaw, yyRaw] = dateMatch;
  const [, hhRaw, minRaw, secRaw] = timeMatch;
  const year = 2000 + Number(yyRaw);
  const monthIndex = Number(mmRaw) - 1;
  const day = Number(ddRaw);
  const hour = Number(hhRaw);
  const minute = Number(minRaw);
  const second = secRaw ? Number(secRaw) : 0;
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

function parseDbsTransactionAlert(rawBody: string): ParsedAlert {
  const transactionRef = /Transaction Ref:\s*([A-Z0-9]+)/i.exec(rawBody)?.[1];
  const amountMatch = /Amount:\s*([A-Z]{3})\s*([0-9,]+\.[0-9]{2})/i.exec(rawBody);
  const fromLine = /From:\s*([^\n\r]+)/i.exec(rawBody)?.[1] ?? "";
  const bankName = /^([A-Z/ ]+?)\s+card/i.exec(fromLine)?.[1]?.trim();
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

function parseUobTransactionAlert(rawBody: string): ParsedAlert {
  const transitMatch = /Your accumulated transit transactions of\s+([A-Z]{3})\s*([0-9,]+\.[0-9]{2})\s+has been billed to your UOB card ending\s*(\d{4})\s+on\s+(\d{2}\/\d{2}\/\d{2})/i.exec(rawBody);
  if (transitMatch) {
    const [, currency, amountRaw, cardLast4, dateRaw] = transitMatch;
    return {
      bankName: "UOB",
      cardLast4,
      merchant: "Transit charges",
      currency: currency.toUpperCase(),
      amountCents: parseAmountToCents(amountRaw),
      transactionDate: parseDateAtUtcMidnight(dateRaw),
      alertType: "PURCHASE",
    };
  }

  const reversalMatch = /A transaction of\s+([0-9,]+\.[0-9]{2})\s+([A-Z]{3})\s+made with your UOB card ending\s*(\d{4})\s+on\s+(\d{2}\s+[A-Z]{3}\s+\d{2},\s*\d{1,2}:\d{2}(?:AM|PM))\s+at\s+(.+?)\s+has been reversed\./i.exec(rawBody);
  if (reversalMatch) {
    const [, amountRaw, currency, cardLast4, dateRaw, merchant] = reversalMatch;
    return {
      bankName: "UOB",
      cardLast4,
      merchant: merchant.trim(),
      currency: currency.toUpperCase(),
      amountCents: parseAmountToCents(amountRaw),
      transactionDate: parseUobReversalDate(dateRaw),
      alertType: "REVERSAL",
    };
  }

  const purchaseMatch = /A transaction of\s+([A-Z]{3})\s*([0-9,]+\.[0-9]{2})\s+was made with your UOB Card ending\s*(\d{4})\s+on\s+(\d{2}\/\d{2}\/\d{2})\s+at\s+(.+?)(?:\.\s+If unauthorised|$)/i.exec(rawBody);
  if (purchaseMatch) {
    const [, currency, amountRaw, cardLast4, dateRaw, merchant] = purchaseMatch;
    return {
      bankName: "UOB",
      cardLast4,
      merchant: merchant.trim(),
      currency: currency.toUpperCase(),
      amountCents: parseAmountToCents(amountRaw),
      transactionDate: parseDateAtUtcMidnight(dateRaw),
      alertType: "PURCHASE",
    };
  }

  return {
    bankName: "UOB",
  };
}

function parseOcbcTransactionAlert(rawBody: string): ParsedAlert {
  const match = /We wish to inform you that\s+([A-Z]{3})\s*([0-9,]+\.[0-9]{2})\s+was charged at\s+(\d{2}:\d{2})\s+on\s+(\d{2}-[A-Z]{3}-\d{2})\s+to your card\s+\(-(\d{4})\)\s+at\s+(.+?)(?:\.|$)/i.exec(rawBody);

  if (!match) {
    return {
      bankName: "OCBC Bank",
    };
  }

  const [, currency, amountRaw, timeRaw, dateRaw, cardLast4, merchant] = match;
  return {
    bankName: "OCBC Bank",
    cardLast4,
    merchant: merchant.trim(),
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
  const amountMatch = /Transaction\s+amount\s*:\s*([A-Z]{3})\s*([0-9,]+\.[0-9]{2})/i.exec(rawBody);
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
