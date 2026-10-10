import { Nfc } from "lucide-react";
import { getBankInitials, getCardGradient } from "./card-appearance";

export function CardPreview({ bankName, themeKey, last4, cardName, expiryMonth, expiryYear }: Readonly<{
  bankName: string;
  themeKey: string;
  last4: string;
  cardName: string;
  expiryMonth: string;
  expiryYear: string;
}>) {
  return (
    <div
      className="cc-preview"
      style={{ background: getCardGradient(bankName, themeKey) }}
    >
      <div className="cc-preview-header">
        <span className="cc-preview-bank">{getBankInitials(bankName)}</span>
        <Nfc size={22} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="cc-preview-chip" aria-hidden="true"><span /><span /><span /></div>
      <div className="cc-preview-number">
        {last4 ? `•••• •••• •••• ${last4}` : "•••• •••• •••• ••••"}
      </div>
      <div className="cc-preview-footer">
        <span>{cardName || "Card Name"}</span>
        <span>
          {expiryMonth && expiryYear
            ? `${expiryMonth}/${expiryYear.slice(-2)}`
            : "••/••"}
        </span>
      </div>
    </div>
  );
}
