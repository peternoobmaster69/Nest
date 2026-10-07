import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseCreditAlert } = require("../lib/credit-alert-parser.ts");
const { parseMaybankCsv, normalizeTransactionSubject, shouldSkipMaybankRow } = require("../lib/maybank-csv.ts");

const dbs = (amount = "sGd 1,234.56", date = "Date & Time: 07 OCT 01:05\nrequest dated 07/10/26") => [
  "Transaction Ref: ABC123", `Amount: ${amount}`, "From: DBS/POSB card ending 0007",
  "To: Corner Coffee Pte. Ltd.", date,
].join("\n");
const uobPurchase = (merchant = "Coffee & Co.", suffix = ". If unauthorised, please contact UOB.") =>
  `A transaction of SGD 12.30 was made with your UOB Card ending 0123 on 07/10/26 at ${merchant}${suffix}`;
const uobReversal = (time = "1:05AM", month = "OCT", merchant = "Coffee & Co.") =>
  `A transaction of 1,234.56 SGD made with your UOB card ending 0123 on 07 ${month} 26, ${time} at ${merchant} has been reversed.`;
const citi = (date = "07/10/26", time = "01:02:03") => [
  "Citibank", "Account Number: XXXX-XXXX-XXXX-0042", `Transaction date: ${date}`,
  `Transaction time: ${time}`, "Transaction amount: usd 9,876.54", "Transaction details: Merchant / Store",
].join("\n");
const ocbc = (date = "07-Oct-26", time = "01:05") =>
  `We wish to inform you that sgd 42.10 was charged at ${time} on ${date} to your card (-9876) at Coffee Shop. Please call the bank if this was not you.`;
const header = "POSTING DATE,TRANSACTION DATE,DESCRIPTION,AMOUNT";

test("DBS alerts retain the transaction reference, card suffix, merchant and exact cents with Singapore timestamps", () => {
  assert.deepEqual(parseCreditAlert(dbs()), {
    transactionRef: "ABC123", bankName: "DBS/POSB", cardLast4: "0007", merchant: "Corner Coffee Pte. Ltd.",
    currency: "SGD", amountCents: 123_456, transactionDate: new Date("2026-10-06T17:05:00Z"), alertType: "PURCHASE",
  });
  assert.equal(parseCreditAlert(dbs("JPY 0.01")).amountCents, 1);
  assert.equal(parseCreditAlert(dbs("USD 0.00")).amountCents, 0);
  assert.equal(parseCreditAlert(dbs(`SGD ${"9".repeat(400)}.00`)).amountCents, undefined);
  assert.equal(parseCreditAlert(dbs("SGD unavailable")).currency, undefined);
});

test("DBS dates prefer the explicit request year and fall back to the current UTC year", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2027-01-02T10:00:00Z") });
  assert.equal(parseCreditAlert(dbs("SGD 1.00", "Date & Time: 01 JAN 07:30")).transactionDate.toISOString(), "2026-12-31T23:30:00.000Z");
  assert.equal(parseCreditAlert(dbs("SGD 1.00", "Date & Time: 01 JAN 07:30\nrequest dated 01/01/25")).transactionDate.toISOString(), "2024-12-31T23:30:00.000Z");
  assert.equal(parseCreditAlert(dbs("SGD 1.00", "Date & Time: 07 XYZ 01:05")).transactionDate, undefined);
  assert.equal(parseCreditAlert(dbs("SGD 1.00", "Date & Time: unavailable")).transactionDate, undefined);
});

test("UOB transit alerts preserve the bank date and create a fixed, recognizable merchant", () => {
  const body = "Your accumulated transit transactions of sgd 1,002.35 has been billed to your UOB card ending 0012 on 31/12/26";
  assert.deepEqual(parseCreditAlert(body), {
    bankName: "UOB", cardLast4: "0012", merchant: "Transit charges", currency: "SGD", amountCents: 100_235,
    transactionDate: new Date("2026-12-31T00:00:00Z"), alertType: "PURCHASE",
  });
});

test("UOB purchase alerts accept both the warning suffix and an alert ending with the merchant", () => {
  for (const suffix of [". If unauthorised, please contact UOB.", ""]) {
    assert.deepEqual(parseCreditAlert(uobPurchase("  Market / Coffee & Co.  ", suffix)), {
      bankName: "UOB", cardLast4: "0123", merchant: "Market / Coffee & Co.", currency: "SGD", amountCents: 1_230,
      transactionDate: new Date("2026-10-07T00:00:00Z"), alertType: "PURCHASE",
    });
  }
});

test("UOB reversals distinguish AM, PM, noon and midnight and keep the reversal type", () => {
  for (const [time, expected] of [
    ["1:05AM", "2026-10-06T17:05:00Z"], ["1:05PM", "2026-10-07T05:05:00Z"],
    ["12:05AM", "2026-10-06T16:05:00Z"], ["12:05PM", "2026-10-07T04:05:00Z"],
  ]) {
    assert.deepEqual(parseCreditAlert(uobReversal(time)), {
      bankName: "UOB", cardLast4: "0123", merchant: "Coffee & Co.", currency: "SGD", amountCents: 123_456,
      transactionDate: new Date(expected), alertType: "REVERSAL",
    });
  }
  assert.equal(parseCreditAlert(uobReversal("1:05AM", "XYZ")).transactionDate, undefined);
});

test("OCBC alerts read the card, merchant and Singapore timestamp from the bank's template", () => {
  assert.deepEqual(parseCreditAlert(ocbc(), "Card Transaction Alert"), {
    bankName: "OCBC Bank", cardLast4: "9876", merchant: "Coffee Shop", currency: "SGD", amountCents: 4_210,
    transactionDate: new Date("2026-10-06T17:05:00Z"), alertType: "PURCHASE",
  });
  assert.equal(parseCreditAlert(ocbc("07-XYZ-26"), "Card Transaction Alert").transactionDate, undefined);
  assert.equal(parseCreditAlert(ocbc().split(". Please")[0], "Card Transaction Alert").merchant, "Coffee Shop");
});

test("Citi alerts work with the subject or the recognizable body and retain seconds", () => {
  const expected = {
    bankName: "Citibank", cardLast4: "0042", merchant: "Merchant / Store", currency: "USD", amountCents: 987_654,
    transactionDate: new Date("2026-10-06T17:02:03Z"), alertType: "PURCHASE",
  };
  assert.deepEqual(parseCreditAlert(citi()), expected);
  assert.deepEqual(parseCreditAlert(citi().replace("Citibank", ""), "Citi Alerts - Credit Card/Ready Credit Transaction"), expected);
  assert.equal(parseCreditAlert(citi("unavailable"), "Citi Alerts - Credit Card/Ready Credit Transaction").transactionDate, undefined);
  assert.equal(parseCreditAlert(citi("07/10/26", "unavailable"), "Citi Alerts - Credit Card/Ready Credit Transaction").transactionDate, undefined);
});

test("incomplete and unrelated bank messages cannot manufacture amounts, dates, or card numbers", () => {
  for (const subject of ["UOB - Transaction Alert", "Your transaction has been reversed"]) {
    assert.deepEqual(parseCreditAlert("Unrecognized message", subject), { bankName: "UOB" });
  }
  assert.deepEqual(parseCreditAlert("Unrecognized message to your card (-", "Card Transaction Alert"), { bankName: "OCBC Bank" });
  const empty = parseCreditAlert("");
  for (const key of ["transactionRef", "bankName", "cardLast4", "merchant", "currency", "amountCents", "transactionDate"]) assert.equal(empty[key], undefined, key);
  assert.equal(parseCreditAlert("From: 123 Bank card ending 1234").bankName, undefined);
  assert.equal(parseCreditAlert("From: A bank account").bankName, undefined);
  assert.deepEqual(parseCreditAlert(uobReversal().replace(" has been reversed.", "")), { bankName: "UOB" });
  const incompleteCiti = parseCreditAlert("Bank notice", "Citi Alerts - Credit Card/Ready Credit Transaction");
  assert.equal(incompleteCiti.bankName, "Citibank");
  assert.equal(incompleteCiti.amountCents, undefined);
  assert.equal(incompleteCiti.transactionDate, undefined);
  assert.equal(incompleteCiti.merchant, undefined);
});

test("blank or multiline merchant fields are rejected instead of combining unrelated message lines", () => {
  assert.deepEqual(parseCreditAlert(uobPurchase(" \t ", "")), { bankName: "UOB" });
  assert.deepEqual(parseCreditAlert(uobPurchase("First merchant\nSecond merchant")), { bankName: "UOB" });
  assert.deepEqual(parseCreditAlert(uobReversal("1:05AM", "OCT", "First merchant\nSecond merchant")), { bankName: "UOB" });
  assert.deepEqual(parseCreditAlert(ocbc().replace("Coffee Shop", " "), "Card Transaction Alert"), { bankName: "OCBC Bank" });
  assert.deepEqual(parseCreditAlert(ocbc().replace("Coffee Shop", "First merchant\nSecond merchant"), "Card Transaction Alert"), { bankName: "OCBC Bank" });
});

test("Maybank exports retain debit and credit signs, comma-separated amounts, and independent dates", () => {
  const rows = parseMaybankCsv(`Export for card 1234\r\n${header}\r\n08 Oct 2026,07 Oct 2026,Coffee, Retail, SGD 1,234.56\r\n09 Oct 2026,08 Oct 2026,Refund,- USD 45.67`);
  assert.deepEqual(rows, [
    { postingDate: new Date("2026-10-08T00:00:00Z"), transactionDate: new Date("2026-10-07T00:00:00Z"), description: "Coffee, Retail", amountCents: -123_456, currency: "SGD" },
    { postingDate: new Date("2026-10-09T00:00:00Z"), transactionDate: new Date("2026-10-08T00:00:00Z"), description: "Refund", amountCents: 4_567, currency: "USD" },
  ]);
});

test("Maybank parsing rejects missing headers and empty exports and skips malformed rows", () => {
  assert.throws(() => parseMaybankCsv(""), /CSV header not found/);
  assert.throws(() => parseMaybankCsv(header), /No Maybank transactions found/);
  assert.throws(() => parseMaybankCsv(`${header}08 Oct 2026,07 Oct 2026,Missing amount,SGD unavailable`), /No Maybank transactions found/);
  assert.throws(() => parseMaybankCsv(`${header}08 XYZ 2026,07 Oct 2026,Invalid,SGD 1.00`), /No Maybank transactions found/);
  assert.throws(() => parseMaybankCsv(`${header}08 Oct 2026,07 XYZ 2026,Invalid,SGD 1.00`), /No Maybank transactions found/);
  assert.throws(() => parseMaybankCsv(`${header}08 Oct 2026,07 Oct 2026,Invalid,SGD ${"9".repeat(400)}.00`), /No Maybank transactions found/);
  const rows = parseMaybankCsv(`${header}08 XYZ 2026,07 Oct 2026,Invalid,SGD 1.0008 Oct 2026,07 Oct 2026, Good   merchant , SGD 2.00`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "Good merchant");
  assert.equal(rows[0].amountCents, -200);
});

test("a currency amount embedded in a Maybank merchant is not mistaken for the row's final amount", () => {
  const [row] = parseMaybankCsv(`${header}08 Oct 2026,07 Oct 2026,Price marker,SGD 1.00 inside description, SGD 2.00`);
  assert.equal(row.description, "Price marker,SGD 1.00 inside description");
  assert.equal(row.amountCents, -200);
});

test("malformed bank inputs with long whitespace do not cause runaway regular-expression backtracking", { timeout: 5_000 }, () => {
  const padding = " ".repeat(100_000);
  const started = performance.now();
  assert.equal(parseCreditAlert(`From: DBS${padding}unrecognized text`).bankName, undefined);
  assert.deepEqual(parseCreditAlert(uobReversal("1:05AM", "OCT", `Merchant${padding}`).replace("has been reversed.", "has not been reversed.")), { bankName: "UOB" });
  assert.throws(() => parseMaybankCsv(`${header}08 Oct 2026,07 Oct 2026,Merchant,${padding}SGD unavailable`), /No Maybank transactions found/);
  assert.ok(performance.now() - started < 1_500, "Malformed input parsing must remain bounded");
});

test("Maybank subject normalization consistently identifies repayment rows without suppressing purchases", () => {
  assert.equal(normalizeTransactionSubject("  Café * Store!\t SGD "), "CAF * STORE SGD");
  assert.equal(shouldSkipMaybankRow("Payment Internet Banking - THANK YOU"), true);
  assert.equal(shouldSkipMaybankRow("PAYMENT\tINTERNET BANKING"), true);
  assert.equal(shouldSkipMaybankRow("Online shopping Internet Banking"), false);
});
