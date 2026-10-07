type ParsedMaybankRow = {
  postingDate: Date;
  transactionDate: Date;
  description: string;
  amountCents: number;
  currency: string;
};

const MAYBANK_HEADER = "POSTING DATE,TRANSACTION DATE,DESCRIPTION,AMOUNT";

function parseMaybankDate(value: string) {
  const [ddRaw, monRaw, yyyyRaw] = value.trim().split(/\s+/);
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

function findRowAmount(body: string, start: number, amounts: RegExp, headers: RegExp) {
  amounts.lastIndex = start;
  for (let amount = amounts.exec(body); amount; amount = amounts.exec(body)) {
    const end = amount.index + amount[0].length;
    headers.lastIndex = end;
    const next = headers.exec(body);
    if (next || end === body.length) return { amount, next };
  }
  return null;
}

function parseMaybankRow(header: RegExpExecArray, amount: RegExpExecArray, description: string): ParsedMaybankRow | null {
  const postingDate = parseMaybankDate(header[1]);
  const transactionDate = parseMaybankDate(header[2]);
  const amountCents = parseAmountToCents(amount[3]);
  if (!postingDate || !transactionDate || amountCents === null) return null;
  return {
    postingDate,
    transactionDate,
    description: description.replace(/\s+/g, " ").trim(),
    amountCents: amount[1] ? amountCents : -amountCents,
    currency: amount[2].toUpperCase(),
  };
}

export function parseMaybankCsv(raw: string) {
  const compact = raw.replace(/\r?\n/g, "");
  const startIndex = compact.indexOf(MAYBANK_HEADER);
  if (startIndex < 0) {
    throw new Error("CSV header not found.");
  }

  const body = compact.slice(startIndex + MAYBANK_HEADER.length);
  const headers = /(\d{2}\s+[A-Za-z]{3}\s+\d{4}),(\d{2}\s+[A-Za-z]{3}\s+\d{4}),/y;
  const amounts = /,\s*(-\s*)?([A-Z]{3})\s*([\d,]+\.\d{2})/g;
  const rows: ParsedMaybankRow[] = [];
  let header = new RegExp(headers.source).exec(body);
  while (header) {
    const start = header.index + header[0].length;
    const end = findRowAmount(body, start, amounts, headers);
    if (!end) break;
    const row = parseMaybankRow(header, end.amount, body.slice(start, end.amount.index));
    if (row) rows.push(row);
    header = end.next;
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
