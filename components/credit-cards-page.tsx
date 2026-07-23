"use client";

import { workspaceFetch } from "@/lib/workspace-client";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";

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
import { useRouter, useSearchParams } from "next/navigation";
import {
  BellRing,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Nfc,
  Pencil,
  Plus,
  RotateCcw,
  WalletCards,
} from "lucide-react";

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
  const res = await workspaceFetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

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

const CARD_THEMES: CardTheme[] = [
  { key: "bank-default", label: "Bank Auto", background: "" },
  { key: "emerald-wave", label: "Emerald Wave", background: "radial-gradient(circle at 82% 3%, rgba(110,231,183,.3), transparent 36%), linear-gradient(145deg, #0d7b68 0%, #126159 50%, #123c43 100%)" },
  { key: "sunset-arc", label: "Sunset Arc", background: "radial-gradient(circle at 14% 8%, rgba(255,230,188,.35), transparent 34%), linear-gradient(145deg, #d85262 0%, #b74650 44%, #7e3548 100%)" },
  { key: "ocean-stripe", label: "Ocean Stripe", background: "repeating-linear-gradient(135deg, rgba(255,255,255,.08) 0 7px, transparent 7px 18px), linear-gradient(145deg, #1769ba 0%, #164b8c 55%, #122b5f 100%)" },
  { key: "midnight-grid", label: "Midnight Grid", background: "linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(145deg, #202939 0%, #111827 58%, #080c14 100%)" },
  { key: "violet-glow", label: "Violet Glow", background: "radial-gradient(circle at 78% 4%, rgba(216,180,254,.38), transparent 35%), linear-gradient(145deg, #7650b6 0%, #563787 52%, #342451 100%)" },
  { key: "carbon-metal", label: "Carbon Metal", background: "repeating-linear-gradient(125deg, rgba(255,255,255,.055) 0 2px, transparent 2px 8px), linear-gradient(145deg, #3a414b 0%, #242a32 50%, #101318 100%)" },
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
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [failedLogos, setFailedLogos] = useState<Record<string, boolean>>({});

  // Form state
  const [cardName, setCardName] = useState("");
  const [bankName, setBankName] = useState(SINGAPORE_BANKS[0].name);
  const [cardLast4, setCardLast4] = useState("");
  const [themeKey, setThemeKey] = useState<string>("bank-default");
  const [plainColor, setPlainColor] = useState("#1f4ba5");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [statementDay, setStatementDay] = useState("25");
  const [paymentDueDay, setPaymentDueDay] = useState("10");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (searchParams.get("add") !== "1") return;

    setEditingCardId(null);
    setCardName("");
    setBankName(SINGAPORE_BANKS[0].name);
    setCardLast4("");
    setThemeKey("bank-default");
    setPlainColor("#1f4ba5");
    setExpiryMonth("");
    setExpiryYear("");
    setStatementDay("25");
    setPaymentDueDay("10");
    setNotes("");
    setIsModalOpen(true);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("add");
    const query = nextParams.toString();
    const destination = `/credit-cards${query ? `?${query}` : ""}`;
    router.replace(routeWorkspaceId ? buildWorkspacePath(routeWorkspaceId, destination) : destination, { scroll: false });
  }, [routeWorkspaceId, router, searchParams]);
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
    queryKey: ["app-context", routeWorkspaceId],
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

  // Keep wallet selection valid as cards load, change, or are removed.
  useEffect(() => {
    if (sortedCards.length === 0) {
      if (selectedCardId) setSelectedCardId(null);
      return;
    }
    if (!selectedCardId || !sortedCards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(sortedCards[0].id);
    }
  }, [sortedCards, selectedCardId]);

  const displayedCards = useMemo(() => {
    if (!isMobileView || isStackExpanded || sortedCards.length <= 1 || !selectedCardId) {
      return sortedCards;
    }
    const selectedCard = sortedCards.find((card) => card.id === selectedCardId);
    if (!selectedCard) return sortedCards;
    return [selectedCard, ...sortedCards.filter((card) => card.id !== selectedCardId)];
  }, [isMobileView, isStackExpanded, selectedCardId, sortedCards]);

  const createCard = useMutation({
    mutationFn: () =>
      fetchJson("/api/credit-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          cardName,
          bankName,
          last4Digit: cardLast4,
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
          last4Digit: cardLast4,
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
    setCardLast4("");
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
    setCardLast4(card.last4Digit);
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
      <div className="cc-header">
        <div className="cc-heading-copy">
          <div className="cc-title-row">
            {!cards.isLoading && !cards.isError ? (
              <span className="cc-title" aria-label={`${sortedCards.length} cards`}>
                {sortedCards.length} Cards
              </span>
            ) : null}
          </div>
        </div>
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

        {!cards.isLoading && !cards.isError && displayedCards.map((card, index) => {
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
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleCardTap(card.id, isCollapsed);
                }
              }}
              className={`cc-card-wrapper ${isFlipped ? "flipped" : ""}${useWalletView ? " cc-wallet-view" : ""}${isCollapsed ? " cc-card-collapsed" : ""}${isSelected ? " cc-card-selected" : ""}`}
              style={{ zIndex: isSelected ? 100 : displayedCards.length - index }}
              role="button"
              tabIndex={0}
              aria-expanded={isFlipped}
              aria-label={`${isCollapsed ? "Select" : isFlipped ? "Hide details for" : "Show details for"} ${card.cardName}, ending in ${card.last4Digit}`}
            >
              <div className="cc-card-front" style={{ background: gradient }}>
                <span className="cc-card-glow" aria-hidden="true" />
                <div className="cc-card-header">
                  <div className="cc-bank-identity">
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
                      {card.expiryMonth && card.expiryYear
                        ? `${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear).slice(-2)}`
                        : "••/••"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="cc-card-back">
                <span className="cc-back-watermark" aria-hidden="true">{bankInitials}</span>
                <div className="cc-back-header">
                  <div className="cc-back-title-block">
                    <span className="cc-back-kicker">{card.bankName || "Credit card"}</span>
                    <span className="cc-back-card-name">{card.cardName}</span>
                  </div>
                  <button
                    className="cc-edit-card-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(card);
                    }}
                    aria-label={`Edit ${card.cardName}`}
                    title="Edit card"
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </button>
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
                      {card.expiryMonth && card.expiryYear
                        ? `${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear).slice(-2)}`
                        : "••/••"}
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
        })}

        {/* Show All / Collapse Button - Mobile Only */}
        {!cards.isLoading && !cards.isError && isMobileView && sortedCards.length > 1 && (
          <button
            className="cc-show-all-btn"
            onClick={() => setIsStackExpanded(!isStackExpanded)}
            aria-expanded={isStackExpanded}
          >
            {isStackExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span>{isStackExpanded ? "Stack cards" : `Browse all ${sortedCards.length} cards`}</span>
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
                  <Nfc size={22} strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="cc-preview-chip" aria-hidden="true"><span /><span /><span /></div>
                <div className="cc-preview-number">
                  {cardLast4 ? `•••• •••• •••• ${cardLast4}` : "•••• •••• •••• ••••"}
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
                  <label className="label">Last 4 digits</label>
                  <input
                    className="input"
                    placeholder="3456"
                    value={cardLast4}
                    onChange={(e) => {
                      const normalized = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setCardLast4(normalized);
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    pattern="\d{4}"
                    required
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
                    className="btn btn-ghost cc-delete modal-action-destructive"
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
