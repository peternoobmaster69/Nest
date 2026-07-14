"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SINGAPORE_BANKS, getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { EmptyState } from "@/components/ui-skeleton";
import { CreditCardsSkeleton } from "@/components/skeletons/CreditCardsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { closeOnBackdropClick } from "@/lib/modal-dismiss";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useSessionState } from "@/lib/use-session-state";
import { Plus } from "lucide-react";

type AppContext = {
  workspaceId: string | null;
};

type CreditCard = {
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

// Bank color schemes for card backgrounds
const BANK_GRADIENTS: Record<string, string> = {
  "DBS Bank": "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
  "OCBC Bank": "linear-gradient(135deg, #ef4444 0%, #991b1b 100%)",
  "United Overseas Bank": "linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)",
  "Citibank Singapore": "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
  "HSBC": "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
  "Standard Chartered": "linear-gradient(135deg, #0d9488 0%, #115e59 100%)",
  "Maybank": "linear-gradient(135deg, #fbbf24 0%, #d97706 100%)",
  "Bank of China": "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
  "ICBC": "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
  "American Express": "linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)",
  "CIMB Bank": "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
};

const DEFAULT_GRADIENT = "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)";

const CARD_THEMES: CardTheme[] = [
  { key: "bank-default", label: "Bank Auto", background: "" },
  { key: "emerald-wave", label: "Emerald Wave", background: "linear-gradient(135deg, #0f766e 0%, #0ea5a4 45%, #34d399 100%)" },
  { key: "sunset-arc", label: "Sunset Arc", background: "radial-gradient(circle at 15% 20%, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 35%), linear-gradient(135deg, #fb7185 0%, #f97316 55%, #facc15 100%)" },
  { key: "ocean-stripe", label: "Ocean Stripe", background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.12) 0 8px, rgba(255,255,255,0.02) 8px 16px), linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%)" },
  { key: "midnight-grid", label: "Midnight Grid", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%), linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)" },
  { key: "violet-glow", label: "Violet Glow", background: "radial-gradient(circle at 75% 15%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 35%), linear-gradient(135deg, #7c3aed 0%, #9333ea 50%, #ec4899 100%)" },
  { key: "carbon-metal", label: "Carbon Metal", background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 6px, rgba(255,255,255,0.02) 6px 12px), linear-gradient(135deg, #111827 0%, #374151 100%)" },
];

function getCardGradient(bankName: string | null, themeKey?: string | null): string {
  if (themeKey?.startsWith("custom:")) {
    return themeKey.replace("custom:", "");
  }
  if (themeKey && themeKey !== "bank-default") {
    return CARD_THEMES.find((theme) => theme.key === themeKey)?.background || DEFAULT_GRADIENT;
  }
  if (!bankName) return DEFAULT_GRADIENT;
  return BANK_GRADIENTS[bankName] || DEFAULT_GRADIENT;
}

function getBankInitials(bankName: string | null): string {
  if (!bankName) return "CC";
  return bankName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CreditCardsPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});

  // Form state
  const [cardName, setCardName] = useState("");
  const [bankName, setBankName] = useState(SINGAPORE_BANKS[0].name);
  const [cardNumber, setCardNumber] = useState("");
  const [themeKey, setThemeKey] = useState<string>("bank-default");
  const [plainColor, setPlainColor] = useState("#1f4ba5");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [statementDay, setStatementDay] = useState("25");
  const [paymentDueDay, setPaymentDueDay] = useState("10");
  const [notes, setNotes] = useState("");
  const [isStackExpanded, setIsStackExpanded] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [selectedCardId, setSelectedCardId] = useSessionState<string | null>("nest:view:credit-cards:selected", null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.matchMedia("(max-width: 768px)").matches);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;

  const cards = useQuery({
    queryKey: ["credit-cards", workspaceId],
    queryFn: () => fetchJson<CreditCard[]>(`/api/credit-cards?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const invalidateCreditCardDependencies = () => {
    void queryClient.invalidateQueries({ queryKey: ["credit-cards", workspaceId], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["credit-transactions"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"], refetchType: "active" });
  };
  const sortedCards = useMemo(() => {
    const list = [...(cards.data ?? [])];
    list.sort((a, b) => {
      const bankA = (a.bankName || "ZZZ").toLowerCase();
      const bankB = (b.bankName || "ZZZ").toLowerCase();
      const byBank = bankA.localeCompare(bankB);
      if (byBank !== 0) return byBank;
      return a.cardName.localeCompare(b.cardName);
    });
    return list;
  }, [cards.data]);

  // Set first card as selected by default when cards load
  useEffect(() => {
    if (sortedCards.length > 0 && !selectedCardId) {
      setSelectedCardId(sortedCards[0].id);
    }
  }, [sortedCards, selectedCardId]);

  const createCard = useMutation({
    mutationFn: () =>
      fetchJson("/api/credit-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          cardName,
          bankName,
          cardNumber: cardNumber || undefined,
          themeKey,
          expiryMonth: expiryMonth ? Number(expiryMonth) : undefined,
          expiryYear: expiryYear ? Number(expiryYear) : undefined,
          statementDay: Number(statementDay),
          paymentDueDay: Number(paymentDueDay),
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      invalidateCreditCardDependencies();
      closeModal();
    },
  });

  const updateCard = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/credit-cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardName,
          bankName,
          cardNumber: cardNumber || undefined,
          themeKey: themeKey || null,
          expiryMonth: expiryMonth ? Number(expiryMonth) : null,
          expiryYear: expiryYear ? Number(expiryYear) : null,
          statementDay: Number(statementDay),
          paymentDueDay: Number(paymentDueDay),
          notes: notes || null,
        }),
      }),
    onSuccess: () => {
      invalidateCreditCardDependencies();
      closeModal();
    },
  });

  const deleteCard = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/credit-cards/${id}`, { method: "DELETE" }),
    onSuccess: invalidateCreditCardDependencies,
  });

  const resetForm = () => {
    setCardName("");
    setBankName(SINGAPORE_BANKS[0].name);
    setCardNumber("");
    setThemeKey("bank-default");
    setPlainColor("#1f4ba5");
    setExpiryMonth("");
    setExpiryYear("");
    setStatementDay("25");
    setPaymentDueDay("10");
    setNotes("");
  };

  const openModal = () => {
    setEditingCardId(null);
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (card: CreditCard) => {
    setEditingCardId(card.id);
    setCardName(card.cardName);
    setBankName(card.bankName || SINGAPORE_BANKS[0].name);
    setCardNumber("");
    setThemeKey(card.themeKey || "bank-default");
    setPlainColor(card.themeKey?.startsWith("custom:") ? card.themeKey.replace("custom:", "") : "#1f4ba5");
    setExpiryMonth(card.expiryMonth ? String(card.expiryMonth) : "");
    setExpiryYear(card.expiryYear ? String(card.expiryYear) : "");
    setStatementDay(String(card.statementDay));
    setPaymentDueDay(String(card.paymentDueDay));
    setNotes(card.notes || "");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingCardId(null);
    resetForm();
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !cardName.trim()) return;
    if (editingCardId) {
      updateCard.mutate(editingCardId);
      return;
    }
    createCard.mutate();
  };

  const toggleCardFlip = (cardId: string) => {
    setFlippedCardId(flippedCardId === cardId ? null : cardId);
  };

  const handleCardTap = (cardId: string, isCollapsed: boolean) => {
    if (isCollapsed) {
      setSelectedCardId(cardId);
      return;
    }
    toggleCardFlip(cardId);
  };

  const confirmDeleteCard = async (cardId: string) => {
    if (!(await confirmDestructiveAction("Delete this credit card?"))) return;
    deleteCard.mutate(cardId, {
      onSuccess: () => {
        closeModal();
      },
    });
  };

  return (
    <div className="cc-container">
      {/* Header with Add Button */}
      <div className="cc-header">
        <h2 className="cc-title">Your Cards</h2>
        <button className="btn btn-primary cc-add-btn mobile-primary-create" onClick={openModal} aria-label="Add card" title="Add card">
          <Plus size={18} aria-hidden="true" />
          <span className="mobile-primary-create-label">Add Card</span>
        </button>
      </div>

      {/* Cards Grid - Apple Wallet Style (mobile only) */}
      <div className={`cc-grid${isMobileView && sortedCards.length > 1 && !isStackExpanded ? " cc-grid-stacked" : ""}`}>
        {cards.isLoading && <CreditCardsSkeleton />}

        {cards.isError && (
          <div className="cc-empty">
            <div className="cc-empty-icon">⚠️</div>
            <p>Failed to load cards</p>
            <button className="btn btn-primary" onClick={() => cards.refetch()}>
              Retry
            </button>
          </div>
        )}

        {!cards.isLoading && !cards.isError && sortedCards.map((card, index) => {
          const isFlipped = flippedCardId === card.id;
          const gradient = getCardGradient(card.bankName, card.themeKey);
          const bankInitials = getBankInitials(card.bankName);
          const collapsedCardNumber = card.last4Digit ? `•••• ${card.last4Digit}` : card.maskedNumber;

          // Wallet collapse logic: only selected card is expanded
          const useWalletView = isMobileView && sortedCards.length > 1 && !isStackExpanded;
          const isSelected = selectedCardId === card.id;
          const isCollapsed = useWalletView && !isSelected;

          return (
            <div
              key={card.id}
              onClick={() => handleCardTap(card.id, isCollapsed)}
              className={`cc-card-wrapper ${isFlipped ? "flipped" : ""}${useWalletView ? " cc-wallet-view" : ""}${isCollapsed ? " cc-card-collapsed" : ""}${isSelected ? " cc-card-selected" : ""}`}
              style={{ zIndex: isSelected ? 100 : sortedCards.length - index }}
            >
              {/* Front of Card */}
              <div className="cc-card-front" style={{ background: gradient }}>
                <div className="cc-card-header">
                  <div className="cc-bank-logo">
                    {(() => {
                      const bank = getSingaporeBankByName(card.bankName);
                      const logo = getBankLogoUrl(bank);
                      return logo && !failedLogos[card.id] ? (
                        <Image
                          src={logo}
                          alt={bank?.name || "Bank"}
                          width={88}
                          height={32}
                          sizes="(max-width: 480px) 72px, 88px"
                          className="cc-bank-img"
                          loading="lazy"
                          onError={() => setFailedLogos((prev) => ({ ...prev, [card.id]: true }))}
                        />
                      ) : (
                        <span className="cc-bank-fallback">{bankInitials}</span>
                      );
                    })()}
                  </div>
                  {isCollapsed && <div className="cc-card-name">{card.cardName}</div>}
                </div>

                <div className="cc-card-number">{isCollapsed ? collapsedCardNumber : card.maskedNumber}</div>

                <div className="cc-card-footer">
                  <div className="cc-card-name">{card.cardName}</div>
                  <div className="cc-card-expiry">
                    {card.expiryMonth && card.expiryYear
                      ? `${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear).slice(-2)}`
                      : "••/••"}
                  </div>
                </div>
              </div>

              {/* Back of Card */}
              <div className="cc-card-back">
                <div className="cc-back-header">
                  <div className="cc-back-header-meta">
                    <span className="cc-back-number mono">{card.maskedNumber}</span>
                    <span className="cc-back-expiry mono">
                      {card.expiryMonth && card.expiryYear
                        ? `${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}`
                        : "—"}
                    </span>
                  </div>
                </div>

                <div className="cc-details">
                  <div className="cc-detail-column cc-detail-column-left">
                    <span className="cc-detail-label">Statement Day</span>
                    <span className="cc-detail-value cc-detail-value-icon" title="Statement day">
                      <span aria-hidden="true" className="cc-detail-icon">🗓</span>
                      <span>{card.statementDay}</span>
                    </span>
                  </div>
                  <div className="cc-detail-column">
                    <span className="cc-detail-label">Payment Due</span>
                    <span className="cc-detail-value cc-detail-value-icon" title="Payment due day">
                      <span aria-hidden="true" className="cc-detail-icon">⏰</span>
                      <span>{card.paymentDueDay}</span>
                    </span>
                  </div>
                  {card.notes && (
                    <div className="cc-detail-row cc-detail-row-wide">
                      <span className="cc-detail-value">{card.notes}</span>
                    </div>
                  )}
                </div>

                <div className="cc-back-actions">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(card);
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Show All / Collapse Button - Mobile Only */}
        {!cards.isLoading && !cards.isError && isMobileView && sortedCards.length > 1 && (
          <button
            className="cc-show-all-btn"
            onClick={() => setIsStackExpanded(!isStackExpanded)}
          >
            <span className="cc-show-all-icon">{isStackExpanded ? "▲" : "▼"}</span>
            <span>{isStackExpanded ? "Show Wallet" : "Show All Cards"}</span>
          </button>
        )}

        {/* Empty State */}
        {!cards.isLoading && !cards.isError && sortedCards.length === 0 && (
          <div className="cc-grid-empty">
            <EmptyState
              icon="💳"
              title="No credit cards yet"
              description="Add your first credit card to track rewards, monitor spending, and manage payment due dates."
              action={
                <button className="btn btn-primary" onClick={openModal}>
                  + Add Your First Card
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* Add Card Modal */}
      {isModalOpen && (
        <div className="cc-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeModal)}>
          <div className="cc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cc-modal-header">
              <h3>{editingCardId ? "Edit Credit Card" : "Add Credit Card"}</h3>
              <ModalCloseButton onClick={closeModal} label={`Close ${editingCardId ? "Edit Credit Card" : "Add Credit Card"}`} />
            </div>

            <form className="cc-modal-form" onSubmit={onSubmit}>
              <div className="cc-modal-scroll">
                {/* Card Preview */}
                <div
                className="cc-preview"
                style={{ background: getCardGradient(bankName, themeKey) }}
              >
                <div className="cc-preview-header">
                  <span className="cc-preview-bank">{getBankInitials(bankName)}</span>
                  <span>📟</span>
                </div>
                <div className="cc-preview-number">
                  {cardNumber ? `•••• •••• •••• ${cardNumber.slice(-4) || "••••"}` : "•••• •••• •••• ••••"}
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

              <div className="cc-form-grid">
                <div className="form-group">
                  <label className="label">Card Name</label>
                  <input
                    className="input"
                    placeholder="e.g., DBS Altitude"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="label">Bank</label>
                  <select className="input" value={bankName} onChange={(e) => setBankName(e.target.value)}>
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group cc-span-2">
                  <label className="label">Card Number</label>
                  <input
                    className="input"
                    placeholder="1234 5678 9012 3456"
                    value={cardNumber}
                    onChange={(e) => {
                      const normalized = e.target.value.replace(/\D/g, "").slice(0, 16);
                      setCardNumber(normalized);
                    }}
                    maxLength={16}
                  />
                </div>

                <div className="form-group cc-span-2">
                  <label className="label">Card Theme</label>
                  <div className="cc-theme-grid">
                    <button
                      type="button"
                      className={`cc-theme-chip${themeKey.startsWith("custom:") ? " on" : ""}`}
                      onClick={() => setThemeKey(`custom:${plainColor}`)}
                      title="Plain color"
                      aria-label="Use plain color"
                    >
                      <span className="cc-theme-swatch" style={{ background: plainColor }} />
                      <span className="cc-theme-label">Plain Color</span>
                      <input
                        type="color"
                        value={plainColor}
                        className="cc-theme-color"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setPlainColor(e.target.value);
                          setThemeKey(`custom:${e.target.value}`);
                        }}
                      />
                    </button>
                    {CARD_THEMES.map((theme) => (
                      <button
                        key={theme.key}
                        type="button"
                        className={`cc-theme-chip${themeKey === theme.key ? " on" : ""}`}
                        onClick={() => setThemeKey(theme.key)}
                        title={theme.label}
                        aria-label={`Use ${theme.label}`}
                      >
                        <span
                          className="cc-theme-swatch"
                          style={{
                            background: theme.key === "bank-default" ? getCardGradient(bankName, null) : theme.background,
                          }}
                        />
                        <span className="cc-theme-label">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="label">Expiry Month</label>
                  <NumericCalculatorInput
                    min="1"
                    max="12"
                    placeholder="MM"
                    value={expiryMonth}
                    allowDecimal={false}
                    onValueChange={(value) => setExpiryMonth(value.slice(0, 2))}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Expiry Year</label>
                  <NumericCalculatorInput
                    min="2024"
                    max="2100"
                    placeholder="YYYY"
                    value={expiryYear}
                    allowDecimal={false}
                    onValueChange={(value) => setExpiryYear(value.slice(0, 4))}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Statement Day</label>
                  <NumericCalculatorInput
                    min="1"
                    max="31"
                    value={statementDay}
                    allowDecimal={false}
                    onValueChange={setStatementDay}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="label">Payment Due Day</label>
                  <NumericCalculatorInput
                    min="1"
                    max="31"
                    value={paymentDueDay}
                    allowDecimal={false}
                    onValueChange={setPaymentDueDay}
                    required
                  />
                </div>

                <div className="form-group cc-span-2">
                  <label className="label">Notes (optional)</label>
                  <input
                    className="input"
                    placeholder="Additional notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              </div>
              <div className="cc-modal-actions">
                {editingCardId ? (
                  <button
                    type="button"
                    className="btn btn-ghost cc-delete"
                    style={{ marginRight: "auto" }}
                    disabled={deleteCard.isPending}
                    onClick={() => confirmDeleteCard(editingCardId)}
                  >
                    {deleteCard.isPending ? "Deleting..." : "Delete Card"}
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createCard.isPending || updateCard.isPending}
                >
                  {editingCardId
                    ? (updateCard.isPending ? "Saving..." : "Save Changes")
                    : (createCard.isPending ? "Adding..." : "Add Card")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
