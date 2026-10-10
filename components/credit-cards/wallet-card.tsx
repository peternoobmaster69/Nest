"use client";

import { useState } from "react";
import Image from "next/image";
import { BellRing, CalendarDays, Nfc, Pencil, RotateCcw } from "lucide-react";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { Button } from "@/components/ui/button";
import { getBankInitials, getCardGradient, type CreditCard } from "./card-appearance";

function getCardAction(collapsed: boolean, flipped: boolean) {
  if (collapsed) return "Select";
  return flipped ? "Hide details for" : "Show details for";
}

function formatExpiry(card: CreditCard) {
  if (!card.expiryMonth || !card.expiryYear) return "••/••";
  return `${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear).slice(-2)}`;
}

function CardBankLogo({ bankName, initials }: Readonly<{ bankName: string | null; initials: string }>) {
  const [failed, setFailed] = useState(false);
  const bank = getSingaporeBankByName(bankName);
  if (!bank || failed) return <span className="cc-bank-fallback">{initials}</span>;
  return <Image src={getBankLogoUrl(bank)!} alt={bank.name} width={88} height={32}
    sizes="(max-width: 480px) 72px, 88px" className="cc-bank-img" loading="lazy" onError={() => setFailed(true)} />;
}

export function WalletCard({ card, isFlipped, useWalletView, isCollapsed, isSelected, zIndex, onToggle, onEdit }: Readonly<{
  card: CreditCard;
  isFlipped: boolean;
  useWalletView: boolean;
  isCollapsed: boolean;
  isSelected: boolean;
  zIndex: number;
  onToggle: () => void;
  onEdit: () => void;
}>) {
  const gradient = getCardGradient(card.bankName, card.themeKey);
  const bankInitials = getBankInitials(card.bankName);
  const collapsedCardNumber = card.last4Digit ? `•••• ${card.last4Digit}` : card.maskedNumber;
  const expiry = formatExpiry(card);
  return (
    <div
      className={`cc-card-wrapper ${isFlipped ? "flipped" : ""}${useWalletView ? " cc-wallet-view" : ""}${isCollapsed ? " cc-card-collapsed" : ""}${isSelected ? " cc-card-selected" : ""}`}
      style={{ zIndex }}
    >
      <Button className="cc-card-toggle" onClick={onToggle} aria-expanded={isFlipped} aria-label={`${getCardAction(isCollapsed, isFlipped)} ${card.cardName}, ending in ${card.last4Digit}`} />
      <div className="cc-card-front" style={{ background: gradient }} aria-hidden={isFlipped}>
        <span className="cc-card-glow" aria-hidden="true" />
        <div className="cc-card-header">
          <div className="cc-bank-identity">
            <div className="cc-bank-logo">
              <CardBankLogo key={card.bankName} bankName={card.bankName} initials={bankInitials} />
            </div>
            {isCollapsed ? (
              <span className="cc-collapsed-card-name">{card.cardName}</span>
            ) : (
              <span className="cc-bank-name">{card.bankName || "Credit card"}</span>
            )}
          </div>
          <span className="cc-contactless" aria-hidden="true"><Nfc size={25} strokeWidth={1.8} /></span>
        </div>

        <div className="cc-card-chip" aria-hidden="true"><span /><span /><span /></div>
        <div className="cc-card-number">{isCollapsed ? collapsedCardNumber : card.maskedNumber}</div>

        <div className="cc-card-footer">
          <div className="cc-card-name-block">
            <span className="cc-card-meta-label">Card</span>
            <div className="cc-card-name">{card.cardName}</div>
          </div>
          <div className="cc-card-expiry-block">
            <span className="cc-card-meta-label">Valid thru</span>
            <div className="cc-card-expiry">
              {expiry}
            </div>
          </div>
        </div>
      </div>

      <div className="cc-card-back" aria-hidden={!isFlipped} inert={!isFlipped}>
        <span className="cc-back-watermark" aria-hidden="true">{bankInitials}</span>
        <div className="cc-back-header">
          <div className="cc-back-title-block">
            <span className="cc-back-kicker">{card.bankName || "Credit card"}</span>
            <span className="cc-back-card-name">{card.cardName}</span>
          </div>
          <Button
            className="cc-edit-card-btn"
            onClick={onEdit}
            aria-label={`Edit ${card.cardName}`}
            title="Edit card"
          >
            <Pencil size={15} aria-hidden="true" />
          </Button>
        </div>

        <div className="cc-back-magnetic-stripe" aria-hidden="true"><span /></div>

        <div className="cc-back-number-band">
          <span className="cc-back-number-group">
            <span className="cc-back-band-label">Card number</span>
            <span className="cc-back-number mono">{card.maskedNumber}</span>
          </span>
          <span className="cc-back-expiry-group">
            <span className="cc-back-band-label">Expires</span>
            <span className="cc-back-expiry mono">
              {expiry}
            </span>
          </span>
        </div>

        <div className="cc-details">
          <div className="cc-detail-column cc-detail-column-left">
            <span className="cc-detail-icon" aria-hidden="true"><CalendarDays size={16} /></span>
            <span className="cc-detail-copy">
              <span className="cc-detail-label">Statement</span>
              <span className="cc-detail-value">Day {card.statementDay}</span>
            </span>
          </div>
          <div className="cc-detail-column">
            <span className="cc-detail-icon" aria-hidden="true"><BellRing size={16} /></span>
            <span className="cc-detail-copy">
              <span className="cc-detail-label">Payment due</span>
              <span className="cc-detail-value">Day {card.paymentDueDay}</span>
            </span>
          </div>
          {card.notes && (
            <div className="cc-detail-row cc-detail-row-wide">
              <span className="cc-detail-label">Notes</span>
              <span className="cc-detail-value cc-detail-note">{card.notes}</span>
            </div>
          )}
        </div>

        <div className="cc-back-hint" aria-hidden="true">
          <RotateCcw size={12} /> Tap to return
        </div>
      </div>
    </div>
  );
}
