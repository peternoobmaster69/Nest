type ParsedMaybankRow = {
  postingDate: Date;
  transactionDate: Date;
  description: string;
  amountCents: number;
  currency: string;
};

const MAYBANK_HEADER = "POSTING DATE,TRANSACTION DATE,DESCRIPTION,AMOUNT";

function parseMaybankDate(value: string) {
  const match = value.trim().match(/(\d{2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match) return null;
  const [, ddRaw, monRaw, yyyyRaw] = match;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthIndex = monthNames.indexOf(monRaw.toLowerCase());
  if (monthIndex < 0) return null;
  return new Date(Date.UTC(Number(yyyyRaw), monthIndex, Number(ddRaw), 0, 0, 0));
}

function parseAmountToCents(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function normalizeTransactionSubject(value: string) {
  return value
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^A-Z0-9* ]/g, "")
    .trim();
}

export function parseMaybankCsv(raw: string) {
  const compact = raw.replace(/\r?\n/g, "");
  const startIndex = compact.indexOf(MAYBANK_HEADER);
  if (startIndex < 0) {
    throw new Error("CSV header not found.");
  }

  const body = compact.slice(startIndex + MAYBANK_HEADER.length);
  const rowPattern =
    /(\d{2}\s+[A-Za-z]{3}\s+\d{4}),(\d{2}\s+[A-Za-z]{3}\s+\d{4}),(.*?),\s*(-?)\s*([A-Z]{3})\s*([0-9,]+\.\d{2})(?=(\d{2}\s+[A-Za-z]{3}\s+\d{4},\d{2}\s+[A-Za-z]{3}\s+\d{4},)|$)/g;

  const rows: ParsedMaybankRow[] = [];

  for (const match of body.matchAll(rowPattern)) {
    const [, postingDateRaw, transactionDateRaw, descriptionRaw, signRaw, currencyRaw, amountRaw] = match;
    const postingDate = parseMaybankDate(postingDateRaw);
    const transactionDate = parseMaybankDate(transactionDateRaw);
    const amountCents = parseAmountToCents(amountRaw);
    if (!postingDate || !transactionDate || amountCents === null) continue;

    rows.push({
      postingDate,
      transactionDate,
      description: descriptionRaw.replace(/\s+/g, " ").trim(),
      amountCents: signRaw === "-" ? amountCents : -amountCents,
      currency: currencyRaw.toUpperCase(),
    });
  }

  if (!rows.length) {
    throw new Error("No Maybank transactions found in CSV.");
  }

  return rows;
}

export function shouldSkipMaybankRow(description: string) {
  const normalized = normalizeTransactionSubject(description);
  return normalized.startsWith("PAYMENT INTERNET BANKING");
}
