export type CurrencyCode = "SGD" | "USD" | "EUR" | "GBP" | "AUD" | "JPY";

export const SUPPORTED_CURRENCIES: CurrencyCode[] = ["SGD", "USD", "EUR", "GBP", "AUD", "JPY"];

export function normalizeCurrency(code?: string | null): CurrencyCode {
  const upper = (code || "SGD").toUpperCase();
  if (SUPPORTED_CURRENCIES.includes(upper as CurrencyCode)) {
    return upper as CurrencyCode;
  }
  return "SGD";
}

export function formatMoney(cents: number, currency?: string | null) {
  const safeCurrency = normalizeCurrency(currency);
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: safeCurrency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatMoneyShort(cents: number) {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(dollars % 1 === 0 ? 0 : 2)}`;
}
