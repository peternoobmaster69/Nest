"use client";

import { apiFetch as fetchJson } from "@/lib/api/client";
import { useWorkspaceId } from "@/components/workspace-provider";
import { buildWorkspacePath } from "@/lib/workspace-entry";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SINGAPORE_BANKS } from "@/lib/singapore-banks";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { SubmitEvent, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui-skeleton";
import { CreditCardsSkeleton } from "@/components/skeletons/CreditCardsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useSessionState } from "@/lib/use-session-state";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { CardThemePicker } from "@/components/credit-cards/card-theme-picker";
import { CARD_THEMES, getCardGradient, type CreditCard } from "@/components/credit-cards/card-appearance";
import { WalletCard } from "@/components/credit-cards/wallet-card";
import { CardPreview } from "@/components/credit-cards/card-preview";

type AppContext = {
  workspaceId: string | null;
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
};

function getSaveLabel(editing: boolean, creating: boolean, updating: boolean) {
  if (editing) return updating ? "Saving..." : "Save Changes";
  return creating ? "Adding..." : "Add Card";
}

export function CreditCardsPage() {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const saving = useRef(false);
  const releaseSave = () => { saving.current = false; };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);

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
    const destination = query ? `/credit-cards?${query}` : "/credit-cards";
    router.replace(routeWorkspaceId ? buildWorkspacePath(routeWorkspaceId, destination) : destination, { scroll: false });
  }, [routeWorkspaceId, router, searchParams]);
  const [isStackExpanded, setIsStackExpanded] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [preferredCardId, setSelectedCardId] = useSessionState<string | null>("nest:view:credit-cards:selected", null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobileView(window.matchMedia("(max-width: 768px)").matches);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });
  const workspaceId = context.data?.workspaceId;

  const cards = useQuery({
    queryKey: queryKeys.key(["credit-cards", workspaceId]),
    queryFn: () => fetchJson<CreditCard[]>(`/api/credit-cards?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const invalidateCreditCardDependencies = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["credit-cards", workspaceId]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["credit-transactions"]), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: queryKeys.key(["dashboard-summary"]), refetchType: "active" });
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

  const selectedCardId = sortedCards.find((card) => card.id === preferredCardId)?.id ?? sortedCards[0]?.id ?? null;
  const useWalletView = isMobileView && sortedCards.length > 1 && !isStackExpanded;

  const displayedCards = useMemo(() => {
    if (!isMobileView || isStackExpanded || sortedCards.length <= 1 || !selectedCardId) {
      return sortedCards;
    }
    const selectedCard = sortedCards.find((card) => card.id === selectedCardId)!;
    return [selectedCard, ...sortedCards.filter((card) => card.id !== selectedCardId)];
  }, [isMobileView, isStackExpanded, selectedCardId, sortedCards]);

  const createCard = useMutation({
    onSettled: releaseSave,
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
    onSettled: releaseSave,
    mutationFn: (id: string) =>
      fetchJson(`/api/credit-cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardName,
          bankName,
          last4Digit: cardLast4,
          themeKey,
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
    onSettled: releaseSave,
    mutationFn: (id: string) => fetchJson(`/api/credit-cards/${id}`, { method: "DELETE" }),
    onSuccess: invalidateCreditCardDependencies,
  });
  const pending = createCard.isPending || updateCard.isPending || deleteCard.isPending;
  const mutationError = createCard.error ?? updateCard.error ?? deleteCard.error;
  const formTitle = editingCardId ? "Edit Credit Card" : "Add Credit Card";

  const resetMutationErrors = () => {
    createCard.reset();
    updateCard.reset();
    deleteCard.reset();
  };

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
    resetMutationErrors();
    setEditingCardId(null);
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (card: CreditCard) => {
    resetMutationErrors();
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

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!workspaceId || !cardName.trim() || saving.current) return;
    saving.current = true;
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
    if (!(await confirmDestructiveAction("Delete this credit card?", "Delete credit card?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "This cannot be undone. Transactions already posted to the ledger remain in financial history.",
    }))) return;
    if (saving.current) return;
    saving.current = true;
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
        <Button className="btn btn-primary cc-add-btn mobile-primary-create" onClick={openModal} aria-label="Add card" title="Add card" disabled={pending}>
          <Plus size={18} aria-hidden="true" />
          <span className="mobile-primary-create-label">Add Card</span>
        </Button>
      </div>

      {/* Cards Grid - Apple Wallet Style (mobile only) */}
      <div className={`cc-grid${isMobileView && sortedCards.length > 1 && !isStackExpanded ? " cc-grid-stacked" : ""}`}>
        {cards.isLoading && <CreditCardsSkeleton />}

        {cards.isError && (
          <div className="cc-empty">
            <div className="cc-empty-icon">⚠️</div>
            <p>Failed to load cards</p>
            <Button className="btn btn-primary" onClick={() => cards.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!cards.isLoading && !cards.isError && displayedCards.map((card, index) => (
          <WalletCard
            key={card.id}
            card={card}
            isFlipped={flippedCardId === card.id && (!useWalletView || selectedCardId === card.id)}
            useWalletView={useWalletView}
            isCollapsed={useWalletView && selectedCardId !== card.id}
            isSelected={selectedCardId === card.id}
            zIndex={selectedCardId === card.id ? 100 : displayedCards.length - index}
            onToggle={() => handleCardTap(card.id, useWalletView && selectedCardId !== card.id)}
            onEdit={() => openEditModal(card)}
          />
        ))}

        {/* Show All / Collapse Button - Mobile Only */}
        {!cards.isLoading && !cards.isError && isMobileView && sortedCards.length > 1 && (
          <Button
            className="cc-show-all-btn"
            onClick={() => setIsStackExpanded(!isStackExpanded)}
            aria-expanded={isStackExpanded}
          >
            {isStackExpanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span>{isStackExpanded ? "Stack cards" : `Browse all ${sortedCards.length} cards`}</span>
          </Button>
        )}

        {/* Empty State */}
        {!cards.isLoading && !cards.isError && sortedCards.length === 0 && (
          <div className="cc-grid-empty">
            <EmptyState
              icon="💳"
              title="No credit cards yet"
              description="Add your first credit card to track rewards, monitor spending, and manage payment due dates."
              action={
                <Button className="btn btn-primary" onClick={openModal}>
                  + Add Your First Card
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* Add Card Modal */}
      {isModalOpen && (
        <Dialog open onClose={closeModal} title="Credit card" surface="custom" overlayClassName="cc-modal-overlay" closeDisabled={pending}>
          <dialog open className="cc-modal">
            <div className="cc-modal-header">
              <h3>{formTitle}</h3>
              <ModalCloseButton onClick={closeModal} label={`Close ${formTitle}`} disabled={pending} />
            </div>

            <form className="cc-modal-form" onSubmit={onSubmit}>
              <div className="cc-modal-scroll">
                {/* Card Preview */}
              <CardPreview bankName={bankName} themeKey={themeKey} last4={cardLast4} cardName={cardName} expiryMonth={expiryMonth} expiryYear={expiryYear} />

              <div className="cc-form-grid">
                <div className="form-group">
                  <label htmlFor="credit-cards-card-name" className="label">Card Name</label>
                  <Input disabled={pending} id="credit-cards-card-name"
                    className="input"
                    placeholder="e.g., DBS Altitude"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="credit-cards-bank-name" className="label">Bank</label>
                  <Select disabled={pending} id="credit-cards-bank-name" className="input" value={bankName} onChange={(e) => setBankName(e.target.value)}>
                    {SINGAPORE_BANKS.map((bank) => (
                      <option key={bank.code} value={bank.name}>
                        {bank.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="form-group cc-span-2">
                  <label htmlFor="credit-cards-card-last4" className="label">Last 4 digits</label>
                  <Input disabled={pending} id="credit-cards-card-last4"
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

                <CardThemePicker
                  disabled={pending}
                  themes={CARD_THEMES}
                  themeKey={themeKey}
                  plainColor={plainColor}
                  bankGradient={getCardGradient(bankName, null)}
                  onThemeChange={setThemeKey}
                  onColorChange={(color) => {
                    setPlainColor(color);
                    setThemeKey(`custom:${color}`);
                  }}
                />

                <div className="form-group">
                  <label htmlFor="credit-cards-expiry-month" className="label">Expiry Month</label>
                  <NumericCalculatorInput disabled={pending} id="credit-cards-expiry-month"
                    min="1"
                    max="12"
                    placeholder="MM"
                    value={expiryMonth}
                    allowDecimal={false}
                    onValueChange={(value) => setExpiryMonth(value.slice(0, 2))}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="credit-cards-expiry-year" className="label">Expiry Year</label>
                  <NumericCalculatorInput disabled={pending} id="credit-cards-expiry-year"
                    min="2024"
                    max="2100"
                    placeholder="YYYY"
                    value={expiryYear}
                    allowDecimal={false}
                    onValueChange={(value) => setExpiryYear(value.slice(0, 4))}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="credit-cards-statement-day" className="label">Statement Day</label>
                  <NumericCalculatorInput disabled={pending} id="credit-cards-statement-day"
                    min="1"
                    max="31"
                    value={statementDay}
                    allowDecimal={false}
                    onValueChange={setStatementDay}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="credit-cards-payment-due-day" className="label">Payment Due Day</label>
                  <NumericCalculatorInput disabled={pending} id="credit-cards-payment-due-day"
                    min="1"
                    max="31"
                    value={paymentDueDay}
                    allowDecimal={false}
                    onValueChange={setPaymentDueDay}
                    required
                  />
                </div>

                <div className="form-group cc-span-2">
                  <label htmlFor="credit-cards-notes" className="label">Notes (optional)</label>
                  <Input disabled={pending} id="credit-cards-notes"
                    className="input"
                    placeholder="Additional notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              </div>
              {mutationError ? <div className="form-error-summary" role="alert">{mutationError.message}</div> : null}
              <div className="cc-modal-actions">
                {editingCardId ? (
                  <Button
                    type="button"
                    className="btn btn-ghost cc-delete modal-action-destructive"
                    disabled={pending}
                    onClick={() => confirmDeleteCard(editingCardId)}
                  >
                    {deleteCard.isPending ? "Deleting..." : "Delete Card"}
                  </Button>
                ) : null}
                <Button type="button" className="btn btn-ghost" onClick={closeModal} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pending}
                >
                  {getSaveLabel(Boolean(editingCardId), createCard.isPending, updateCard.isPending)}
                </Button>
              </div>
            </form>
          </dialog>
        </Dialog>
      )}
    </div>
  );
}
