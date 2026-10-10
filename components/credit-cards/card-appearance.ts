export type CreditCard = {
  id: string;
  cardName: string;
  bankName: string | null;
  themeKey?: string | null;
  last4Digit: string;
  maskedNumber: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  statementDay: number;
  paymentDueDay: number;
  notes: string | null;
};

type CardTheme = {
  key: string;
  label: string;
  background: string;
};

// Rich, low-glare issuer materials inspired by native wallet cards.
const BANK_GRADIENTS: Record<string, string> = {
  "DBS Bank": "radial-gradient(circle at 82% 5%, rgba(255,255,255,.24), transparent 34%), linear-gradient(145deg, #d91e3b 0%, #9c0f2a 54%, #520b1b 100%)",
  "OCBC Bank": "radial-gradient(circle at 12% 0%, rgba(255,255,255,.22), transparent 33%), linear-gradient(145deg, #ec2438 0%, #af1025 58%, #650718 100%)",
  "United Overseas Bank": "radial-gradient(circle at 80% 0%, rgba(111,203,255,.35), transparent 36%), linear-gradient(145deg, #075ea8 0%, #123c84 58%, #0a1d52 100%)",
  "Citibank Singapore": "radial-gradient(circle at 86% 4%, rgba(93,190,255,.32), transparent 35%), linear-gradient(145deg, #1174c3 0%, #174a94 56%, #10255b 100%)",
  "HSBC": "radial-gradient(circle at 8% 5%, rgba(255,255,255,.2), transparent 32%), linear-gradient(145deg, #d81f36 0%, #9f1125 55%, #4b0a15 100%)",
  "Standard Chartered": "radial-gradient(circle at 83% 6%, rgba(96,255,220,.25), transparent 34%), linear-gradient(145deg, #098c82 0%, #08706d 48%, #073d50 100%)",
  "Maybank": "radial-gradient(circle at 82% 0%, rgba(255,226,111,.3), transparent 34%), linear-gradient(145deg, #b87900 0%, #7b4d00 54%, #332307 100%)",
  "Bank of China": "radial-gradient(circle at 82% 0%, rgba(255,255,255,.2), transparent 34%), linear-gradient(145deg, #bd1830 0%, #850e24 55%, #460815 100%)",
  "ICBC": "radial-gradient(circle at 80% 0%, rgba(255,255,255,.2), transparent 34%), linear-gradient(145deg, #d32237 0%, #981226 55%, #520815 100%)",
  "American Express": "radial-gradient(circle at 84% 3%, rgba(116,222,255,.32), transparent 36%), linear-gradient(145deg, #1389a9 0%, #0a607f 52%, #073653 100%)",
  "CIMB Bank": "radial-gradient(circle at 82% 0%, rgba(255,255,255,.2), transparent 34%), linear-gradient(145deg, #d22235 0%, #941125 56%, #4f0715 100%)",
};

const DEFAULT_GRADIENT = "radial-gradient(circle at 82% 3%, rgba(167,139,250,.38), transparent 35%), linear-gradient(145deg, #4f46a8 0%, #343277 52%, #1f214e 100%)";

export const CARD_THEMES: CardTheme[] = [
  { key: "bank-default", label: "Bank Auto", background: "" },
  { key: "emerald-wave", label: "Emerald Wave", background: "radial-gradient(circle at 82% 3%, rgba(110,231,183,.3), transparent 36%), linear-gradient(145deg, #0d7b68 0%, #126159 50%, #123c43 100%)" },
  { key: "sunset-arc", label: "Sunset Arc", background: "radial-gradient(circle at 14% 8%, rgba(255,230,188,.35), transparent 34%), linear-gradient(145deg, #d85262 0%, #b74650 44%, #7e3548 100%)" },
  { key: "ocean-stripe", label: "Ocean Stripe", background: "repeating-linear-gradient(135deg, rgba(255,255,255,.08) 0 7px, transparent 7px 18px), linear-gradient(145deg, #1769ba 0%, #164b8c 55%, #122b5f 100%)" },
  { key: "midnight-grid", label: "Midnight Grid", background: "linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(145deg, #202939 0%, #111827 58%, #080c14 100%)" },
  { key: "violet-glow", label: "Violet Glow", background: "radial-gradient(circle at 78% 4%, rgba(216,180,254,.38), transparent 35%), linear-gradient(145deg, #7650b6 0%, #563787 52%, #342451 100%)" },
  { key: "carbon-metal", label: "Carbon Metal", background: "repeating-linear-gradient(125deg, rgba(255,255,255,.055) 0 2px, transparent 2px 8px), linear-gradient(145deg, #3a414b 0%, #242a32 50%, #101318 100%)" },
];

export function getCardGradient(bankName: string | null, themeKey?: string | null): string {
  if (themeKey?.startsWith("custom:")) {
    return themeKey.replace("custom:", "");
  }
  if (themeKey && themeKey !== "bank-default") {
    return CARD_THEMES.find((theme) => theme.key === themeKey)?.background || DEFAULT_GRADIENT;
  }
  if (!bankName) return DEFAULT_GRADIENT;
  return BANK_GRADIENTS[bankName] || DEFAULT_GRADIENT;
}

export function getBankInitials(bankName: string | null): string {
  if (!bankName) return "CC";
  return bankName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

