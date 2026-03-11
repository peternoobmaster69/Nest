"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useEffect, useState } from "react";
import { SkeletonCard, SkeletonMiniCard, EmptyState } from "@/components/ui-skeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";

type CreditCardReward = {
  id: string;
  creditCardId: string;
  currentPoints: number;
  pointsValueCents: number | null;
  lastUpdated: string;
  creditCard: {
    cardName: string;
    bankName: string | null;
    last4Digit: string;
  };
};

type FrequentFlyer = {
  id: string;
  programName: string;
  airlineName: string;
  accountNumber: string | null;
  currentMiles: number;
  targetMiles: number | null;
  expiryWarning: number;
  notes: string | null;
  isActive: boolean;
  expirySummary: Array<{
    month: string;
    amount: number;
  }>;
};

type MileProgramHistory = {
  id: string;
  date: string;
  miles: number;
  balanceMiles: number;
  title: string | null;
  expiryDate: string | null;
  firstRedeemedDate: string | null;
};

type MileRedemptionHistory = {
  id: string;
  redemptionTitle: string;
  totalMilesRedeemed: number;
  dateTime: string;
  details: Array<{
    id: string;
    milesRedeemed: number;
    milesFile: {
      id: string;
      title: string | null;
      date: string;
    };
  }>;
};

type FrequentFlyerHistoryResponse = {
  milePrograms: MileProgramHistory[];
  redemptions: MileRedemptionHistory[];
  totals: {
    earned: number;
    available: number;
    redeemed: number;
  };
};

type PointConversion = {
  id: string;
  creditCardRewardId: string | null;
  frequentFlyerId: string | null;
  fromPoints: number;
  toMiles: number;
  conversionRate: number;
  description: string | null;
  creditCardReward: {
    creditCard: {
      cardName: string;
    };
  } | null;
  frequentFlyer: {
    programName: string;
  } | null;
  createdAt: string;
};

type AvailableCard = {
  id: string;
  cardName: string;
  bankName: string | null;
  last4Digit: string;
};

type AppContext = {
  workspaceId: string | null;
  baseCurrency?: string | null;
};

async function fetchRewards(): Promise<{
  creditCards: CreditCardReward[];
  frequentFlyers: FrequentFlyer[];
  conversions: PointConversion[];
  cardsWithoutRewards: AvailableCard[];
}> {
  const res = await fetch("/api/rewards");
  if (!res.ok) throw new Error("Failed to fetch rewards");
  return res.json();
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

const EARN_PAGE_SIZE = 8;
const REDEMPTION_PAGE_SIZE = 6;

function isExpiredAtToday(dateValue: string | null): boolean {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date < today;
}

export function RewardsPage({
  initialCreditCards,
  initialFrequentFlyers,
  initialConversions,
  availableCards,
}: {
  initialCreditCards: CreditCardReward[];
  initialFrequentFlyers: FrequentFlyer[];
  initialConversions: PointConversion[];
  availableCards: AvailableCard[];
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"credit-cards" | "frequent-flyers" | "conversions">("credit-cards");

  // Forms state
  const [newCardId, setNewCardId] = useState("");
  const [newCardPoints, setNewCardPoints] = useState("");
  const [newCardValue, setNewCardValue] = useState("");
  const [newCardConvPoints, setNewCardConvPoints] = useState("10000");
  const [newCardConvMiles, setNewCardConvMiles] = useState("4000");
  const [newCardConvDesc, setNewCardConvDesc] = useState("");


  const [convCardId, setConvCardId] = useState("");
  const [convFFId, setConvFFId] = useState("");
  const [convPoints, setConvPoints] = useState("");
  const [convMiles, setConvMiles] = useState("");
  const [convDesc, setConvDesc] = useState("");
  const [editingConversionId, setEditingConversionId] = useState<string | null>(null);
  const [editingConvPoints, setEditingConvPoints] = useState("");
  const [editingConvMiles, setEditingConvMiles] = useState("");
  const [editingConvDesc, setEditingConvDesc] = useState("");
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardPoints, setEditingCardPoints] = useState("");

  // Frequent Flyer modal state
  const [isFFModalOpen, setIsFFModalOpen] = useState(false);
  const [editingFFId, setEditingFFId] = useState<string | null>(null);
  const [isAddEarnModalOpen, setIsAddEarnModalOpen] = useState(false);
  const [isRedeemModalOpen, setIsRedeemModalOpen] = useState(false);
  const [ffFormProgram, setFFFormProgram] = useState("");
  const [ffFormAirline, setFFFormAirline] = useState("");
  const [ffFormNumber, setFFFormNumber] = useState("");
  const [ffFormMiles, setFFFormMiles] = useState("");
  const [ffFormTarget, setFFFormTarget] = useState("");
  const [ffFormExpiry, setFFFormExpiry] = useState("6");
  const [ffFormNotes, setFFFormNotes] = useState("");
  const [openHistoryFFId, setOpenHistoryFFId] = useState<string | null>(null);
  const [earnDate, setEarnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [earnMiles, setEarnMiles] = useState("");
  const [earnTitle, setEarnTitle] = useState("");
  const [earnExpiryDate, setEarnExpiryDate] = useState("");
  const [redeemDate, setRedeemDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [redeemTitle, setRedeemTitle] = useState("");
  const [redeemMiles, setRedeemMiles] = useState("");
  const [editingEarnId, setEditingEarnId] = useState<string | null>(null);
  const [editingEarnDate, setEditingEarnDate] = useState("");
  const [editingEarnMiles, setEditingEarnMiles] = useState("");
  const [editingEarnTitle, setEditingEarnTitle] = useState("");
  const [editingEarnExpiryDate, setEditingEarnExpiryDate] = useState("");
  const [earnPage, setEarnPage] = useState(1);
  const [redemptionPage, setRedemptionPage] = useState(1);

  const context = useQuery({
    queryKey: ["app-context"],
    queryFn: async () => {
      const res = await fetch("/api/context");
      if (!res.ok) throw new Error("Failed to fetch context");
      return res.json() as Promise<AppContext>;
    },
  });
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const formatCurrency = (cents: number | null): string => {
    if (cents === null) return formatMoney(0, baseCurrency);
    return formatMoney(cents, baseCurrency);
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["rewards"],
    queryFn: fetchRewards,
    initialData: {
      creditCards: initialCreditCards,
      frequentFlyers: initialFrequentFlyers,
      conversions: initialConversions,
      cardsWithoutRewards: availableCards,
    },
  });

  const historyQuery = useQuery({
    queryKey: ["rewards", "frequent-flyer-history", openHistoryFFId],
    queryFn: async (): Promise<FrequentFlyerHistoryResponse> => {
      if (!openHistoryFFId) {
        throw new Error("Frequent flyer is required");
      }
      const res = await fetch(`/api/rewards/frequent-flyer/history?frequentFlyerId=${openHistoryFFId}`);
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Failed to load history");
      }
      return (await res.json()) as FrequentFlyerHistoryResponse;
    },
    enabled: !!openHistoryFFId,
  });

  useEffect(() => {
    setEarnPage(1);
    setRedemptionPage(1);
  }, [openHistoryFFId]);

  const createCardReward = useMutation({
    mutationFn: (payload: {
      creditCardId: string;
      currentPoints: number;
      pointsValueCents?: number;
      conversionFromPoints: number;
      conversionToMiles: number;
      conversionDescription?: string;
    }) =>
      fetch("/api/rewards/credit-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setNewCardId("");
      setNewCardPoints("");
      setNewCardValue("");
      setNewCardConvPoints("10000");
      setNewCardConvMiles("4000");
      setNewCardConvDesc("");
    },
  });

  const updateCardReward = useMutation({
    mutationFn: (payload: { id: string; currentPoints: number; pointsValueCents?: number }) =>
      fetch("/api/rewards/credit-card", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setEditingCardId(null);
      setEditingCardPoints("");
    },
  });

  const createFrequentFlyer = useMutation({
    mutationFn: (payload: {
      programName: string;
      airlineName: string;
      accountNumber?: string;
      currentMiles: number;
      targetMiles?: number;
      expiryWarning?: number;
      notes?: string;
    }) =>
      fetch("/api/rewards/frequent-flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      closeFFModal();
    },
  });

  const updateFrequentFlyer = useMutation({
    mutationFn: (payload: {
      id: string;
      programName: string;
      airlineName: string;
      accountNumber?: string;
      currentMiles: number;
      targetMiles?: number;
      expiryWarning?: number;
      notes?: string;
    }) =>
      fetch("/api/rewards/frequent-flyer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      closeFFModal();
    },
  });

  const createConversion = useMutation({
    mutationFn: (payload: {
      creditCardRewardId: string;
      frequentFlyerId: string;
      fromPoints: number;
      toMiles: number;
      description?: string;
    }) =>
      fetch("/api/rewards/conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setConvCardId("");
      setConvFFId("");
      setConvPoints("");
      setConvMiles("");
      setConvDesc("");
    },
  });

  const deleteCardReward = useMutation({
    mutationFn: (id: string) => fetch(`/api/rewards/credit-card?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rewards"] }),
  });

  const deleteFrequentFlyer = useMutation({
    mutationFn: (id: string) => fetch(`/api/rewards/frequent-flyer?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rewards"] }),
  });

  const deleteConversion = useMutation({
    mutationFn: (id: string) => fetch(`/api/rewards/conversion?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rewards"] }),
  });

  const updateConversion = useMutation({
    mutationFn: (payload: { id: string; fromPoints: number; toMiles: number; description?: string }) =>
      fetch("/api/rewards/conversion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setEditingConversionId(null);
      setEditingConvPoints("");
      setEditingConvMiles("");
      setEditingConvDesc("");
    },
  });

  const refreshRewardsAndHistory = () => {
    queryClient.invalidateQueries({ queryKey: ["rewards"] });
    if (openHistoryFFId) {
      queryClient.invalidateQueries({
        queryKey: ["rewards", "frequent-flyer-history", openHistoryFFId],
      });
    }
  };

  const createEarnTransaction = useMutation({
    mutationFn: async (payload: {
      frequentFlyerId: string;
      date: string;
      miles: number;
      title?: string;
      expiryDate?: string;
    }) => {
      const res = await fetch("/api/rewards/frequent-flyer/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "earn",
          frequentFlyerId: payload.frequentFlyerId,
          date: new Date(`${payload.date}T00:00:00.000Z`).toISOString(),
          miles: payload.miles,
          title: payload.title,
          expiryDate: payload.expiryDate ? new Date(`${payload.expiryDate}T00:00:00.000Z`).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const errorPayload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error || "Failed to add earn transaction");
      }
    },
    onSuccess: () => {
      setEarnMiles("");
      setEarnTitle("");
      setEarnExpiryDate("");
      setIsAddEarnModalOpen(false);
      refreshRewardsAndHistory();
    },
  });

  const updateEarnTransaction = useMutation({
    mutationFn: async (payload: {
      frequentFlyerId: string;
      id: string;
      date: string;
      miles: number;
      title?: string;
      expiryDate?: string;
    }) => {
      const res = await fetch("/api/rewards/frequent-flyer/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "earn",
          frequentFlyerId: payload.frequentFlyerId,
          id: payload.id,
          date: new Date(`${payload.date}T00:00:00.000Z`).toISOString(),
          miles: payload.miles,
          title: payload.title,
          expiryDate: payload.expiryDate ? new Date(`${payload.expiryDate}T00:00:00.000Z`).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const errorPayload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error || "Failed to update earn transaction");
      }
    },
    onSuccess: () => {
      setEditingEarnId(null);
      refreshRewardsAndHistory();
    },
  });

  const createRedeemTransaction = useMutation({
    mutationFn: async (payload: {
      frequentFlyerId: string;
      date: string;
      redemptionTitle: string;
      milesToRedeem: number;
    }) => {
      const res = await fetch("/api/rewards/frequent-flyer/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "redeem",
          frequentFlyerId: payload.frequentFlyerId,
          dateTime: new Date(`${payload.date}T00:00:00.000Z`).toISOString(),
          redemptionTitle: payload.redemptionTitle,
          milesToRedeem: payload.milesToRedeem,
        }),
      });
      if (!res.ok) {
        const errorPayload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error || "Failed to redeem miles");
      }
    },
    onSuccess: () => {
      setRedeemMiles("");
      setRedeemTitle("");
      setIsRedeemModalOpen(false);
      refreshRewardsAndHistory();
    },
  });

  const onCreateCardReward = (e: FormEvent) => {
    e.preventDefault();
    if (!newCardId || !newCardPoints) return;
    createCardReward.mutate({
      creditCardId: newCardId,
      currentPoints: parseInt(newCardPoints),
      pointsValueCents: newCardValue ? Math.round(parseFloat(newCardValue) * 100) : undefined,
      conversionFromPoints: parseInt(newCardConvPoints),
      conversionToMiles: parseInt(newCardConvMiles),
      conversionDescription: newCardConvDesc || undefined,
    });
  };

  const onCreateConversion = (e: FormEvent) => {
    e.preventDefault();
    if (!convCardId || !convFFId || !convPoints || !convMiles) return;
    createConversion.mutate({
      creditCardRewardId: convCardId,
      frequentFlyerId: convFFId,
      fromPoints: parseInt(convPoints),
      toMiles: parseInt(convMiles),
      description: convDesc || undefined,
    });
  };

  const beginEditConversion = (conversion: PointConversion) => {
    setEditingConversionId(conversion.id);
    setEditingConvPoints(String(conversion.fromPoints));
    setEditingConvMiles(String(conversion.toMiles));
    setEditingConvDesc(conversion.description || "");
  };

  // Frequent Flyer modal helpers
  const resetFFForm = () => {
    setFFFormProgram("");
    setFFFormAirline("");
    setFFFormNumber("");
    setFFFormMiles("");
    setFFFormTarget("");
    setFFFormExpiry("6");
    setFFFormNotes("");
  };

  const closeFFModal = () => {
    setIsFFModalOpen(false);
    setEditingFFId(null);
    resetFFForm();
  };

  const openAddFFModal = () => {
    setEditingFFId(null);
    resetFFForm();
    setIsFFModalOpen(true);
  };

  const openEditFFModal = (ff: FrequentFlyer) => {
    setEditingFFId(ff.id);
    setFFFormProgram(ff.programName);
    setFFFormAirline(ff.airlineName);
    setFFFormNumber(ff.accountNumber || "");
    setFFFormMiles(String(ff.currentMiles));
    setFFFormTarget(ff.targetMiles ? String(ff.targetMiles) : "");
    setFFFormExpiry(String(ff.expiryWarning));
    setFFFormNotes(ff.notes || "");
    setIsFFModalOpen(true);
  };

  const onSubmitFF = (e: FormEvent) => {
    e.preventDefault();
    if (!ffFormProgram || !ffFormAirline) return;
    const payload = {
      programName: ffFormProgram,
      airlineName: ffFormAirline,
      accountNumber: ffFormNumber || undefined,
      currentMiles: parseInt(ffFormMiles) || 0,
      targetMiles: ffFormTarget ? parseInt(ffFormTarget) : undefined,
      expiryWarning: parseInt(ffFormExpiry) || 6,
      notes: ffFormNotes || undefined,
    };
    if (editingFFId) {
      updateFrequentFlyer.mutate({ id: editingFFId, ...payload });
    } else {
      createFrequentFlyer.mutate(payload);
    }
  };

  const openHistoryForFrequentFlyer = (frequentFlyerId: string) => {
    if (openHistoryFFId === frequentFlyerId) {
      setOpenHistoryFFId(null);
      setEditingEarnId(null);
      return;
    }
    setOpenHistoryFFId(frequentFlyerId);
    setEditingEarnId(null);
  };

  const confirmDeleteCardReward = (id: string) => {
    if (!confirmDestructiveAction("Delete this credit card rewards record?")) return;
    deleteCardReward.mutate(id);
  };

  const confirmDeleteFrequentFlyer = (id: string) => {
    if (!confirmDestructiveAction("Delete this frequent flyer account?")) return;
    deleteFrequentFlyer.mutate(id);
  };

  const confirmDeleteConversion = (id: string) => {
    if (!confirmDestructiveAction("Delete this conversion rate?")) return;
    deleteConversion.mutate(id);
  };

  const totalMiles = data?.frequentFlyers.reduce((sum, f) => sum + f.currentMiles, 0) || 0;
  const conversionByRewardId = new Map<string, PointConversion>();
  for (const conversion of data?.conversions ?? []) {
    if (conversion.creditCardRewardId && !conversionByRewardId.has(conversion.creditCardRewardId)) {
      conversionByRewardId.set(conversion.creditCardRewardId, conversion);
    }
  }
  const totalCreditCardMiles =
    data?.creditCards.reduce((sum, card) => {
      const conversion = conversionByRewardId.get(card.id);
      if (!conversion) return sum;
      return sum + Math.floor(card.currentPoints * conversion.conversionRate);
    }, 0) || 0;
  const totalCombinedMiles = totalCreditCardMiles + totalMiles;
  const selectedHistoryFrequentFlyer = data?.frequentFlyers.find((ff) => ff.id === openHistoryFFId) ?? null;
  const earnEntries = historyQuery.data?.milePrograms ?? [];
  const redemptionEntries = historyQuery.data?.redemptions ?? [];
  const earnTotalPages = Math.max(1, Math.ceil(earnEntries.length / EARN_PAGE_SIZE));
  const redemptionTotalPages = Math.max(1, Math.ceil(redemptionEntries.length / REDEMPTION_PAGE_SIZE));
  const safeEarnPage = Math.min(earnPage, earnTotalPages);
  const safeRedemptionPage = Math.min(redemptionPage, redemptionTotalPages);
  const pagedEarnEntries = earnEntries.slice(
    (safeEarnPage - 1) * EARN_PAGE_SIZE,
    safeEarnPage * EARN_PAGE_SIZE,
  );
  const pagedRedemptionEntries = redemptionEntries.slice(
    (safeRedemptionPage - 1) * REDEMPTION_PAGE_SIZE,
    safeRedemptionPage * REDEMPTION_PAGE_SIZE,
  );

  useEffect(() => {
    if (earnPage > earnTotalPages) setEarnPage(earnTotalPages);
  }, [earnPage, earnTotalPages]);

  useEffect(() => {
    if (redemptionPage > redemptionTotalPages) setRedemptionPage(redemptionTotalPages);
  }, [redemptionPage, redemptionTotalPages]);

  return (
    <div>
      {/* Summary Stats */}
      <section className="stat-card" style={{ marginBottom: "20px", display: "grid", gap: "12px" }}>
        {isLoading ? (
          <>
            <div style={{ display: "grid", gap: "8px" }}>
              <SkeletonMiniCard />
            </div>
            <div className="grid-2" style={{ gap: "10px" }}>
              <SkeletonMiniCard />
              <SkeletonMiniCard />
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="stat-label">Total Miles</div>
              <div className="stat-value">{formatNumber(totalCombinedMiles)}</div>
              <div className="stat-sub">Combined miles across cards and frequent flyer programs</div>
            </div>
            <div className="grid-2" style={{ gap: "10px" }}>
              <div className="card-sm" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                <div className="stat-label">Miles Across Credit Cards</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700 }}>
                  {formatNumber(totalCreditCardMiles)}
                </div>
                <div className="stat-sub">Across {data?.creditCards.length || 0} cards</div>
              </div>
              <div className="card-sm" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                <div className="stat-label">Frequent Flyer Miles</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700 }}>
                  {formatNumber(totalMiles)}
                </div>
                <div className="stat-sub">Across {data?.frequentFlyers.length || 0} programs</div>
              </div>
            </div>
          </>
        )}
      </section>

      {isError && (
        <div className="card" style={{ marginBottom: "20px" }}>
          <EmptyState
            icon="⚠️"
            title="Failed to load rewards"
            action={
              <button className="btn btn-primary" onClick={() => refetch()}>
                Retry
              </button>
            }
          />
        </div>
      )}

      {/* Tabs */}
      <div className="segmented" style={{ marginBottom: "20px" }}>
        <button
          className={`segmented-btn ${activeTab === "credit-cards" ? "on" : ""}`}
          onClick={() => setActiveTab("credit-cards")}
        >
          Credit Cards
        </button>
        <button
          className={`segmented-btn ${activeTab === "frequent-flyers" ? "on" : ""}`}
          onClick={() => setActiveTab("frequent-flyers")}
        >
          Frequent Flyer
        </button>
        <button
          className={`segmented-btn ${activeTab === "conversions" ? "on" : ""}`}
          onClick={() => setActiveTab("conversions")}
        >
          Conversions
        </button>
      </div>

      {/* Credit Cards Tab */}
      {activeTab === "credit-cards" && (
        <div>
          <div className="rewards-cc-grid" style={{ marginBottom: "20px" }}>
            {isLoading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
            {!isLoading && !isError && data?.creditCards.length === 0 && (
              <EmptyState
                icon="💳"
                title="No credit card rewards"
                description="Add your first credit card to start tracking rewards points and their conversion to miles."
              />
            )}
            {!isLoading && data?.creditCards.map((card) => (
              <div key={card.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>
                      {card.creditCard.cardName} ••{card.creditCard.last4Digit}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {card.creditCard.bankName || "Unknown Bank"}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => confirmDeleteCardReward(card.id)}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ marginTop: "12px" }}>
                  <div style={{ fontSize: "24px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                    {formatNumber(card.currentPoints)}
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--brand-500)", marginTop: "2px" }}>
                    {(() => {
                      const conversion = conversionByRewardId.get(card.id);
                      if (!conversion) return "Set conversion";
                      return `${formatNumber(Math.floor(card.currentPoints * conversion.conversionRate))} miles`;
                    })()}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                    points{" "}
                    {(() => {
                      const conversion = conversionByRewardId.get(card.id);
                      if (!conversion) return "• no conversion";
                      return `• ${conversion.fromPoints}:${conversion.toMiles}`;
                    })()}
                  </div>
                </div>
                {editingCardId === card.id ? (
                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={editingCardPoints}
                      onChange={(e) => setEditingCardPoints(e.target.value)}
                    />
                    <button
                      className="btn btn-secondary btn-xs"
                      onClick={() =>
                        updateCardReward.mutate({
                          id: card.id,
                          currentPoints: parseInt(editingCardPoints || "0"),
                        })
                      }
                    >
                      Save
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => setEditingCardId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: "10px" }}>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setEditingCardId(card.id);
                        setEditingCardPoints(String(card.currentPoints));
                      }}
                    >
                      Edit Balance
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {data?.cardsWithoutRewards.length ? (
            <form className="card" onSubmit={onCreateCardReward}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>
                Add Credit Card Rewards
              </div>
              <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr auto" }}>
                <select
                  className="input"
                  value={newCardId}
                  onChange={(e) => setNewCardId(e.target.value)}
                  required
                >
                  <option value="">Select card...</option>
                  {data.cardsWithoutRewards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.cardName} ••{card.last4Digit}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="input"
                  placeholder="Current points"
                  value={newCardPoints}
                  onChange={(e) => setNewCardPoints(e.target.value)}
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  placeholder="Cash value ($)"
                  value={newCardValue}
                  onChange={(e) => setNewCardValue(e.target.value)}
                />
                <input
                  type="number"
                  className="input"
                  placeholder="Conv points"
                  value={newCardConvPoints}
                  onChange={(e) => setNewCardConvPoints(e.target.value)}
                  required
                />
                <input
                  type="number"
                  className="input"
                  placeholder="Conv miles"
                  value={newCardConvMiles}
                  onChange={(e) => setNewCardConvMiles(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={createCardReward.isPending}>
                  Add
                </button>
              </div>
              <input
                type="text"
                className="input"
                placeholder="Conversion description (optional)"
                value={newCardConvDesc}
                onChange={(e) => setNewCardConvDesc(e.target.value)}
                style={{ marginTop: "8px" }}
              />
            </form>
          ) : (
            <div className="card" style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
              All credit cards have rewards tracked. Add more cards to track their rewards.
            </div>
          )}
        </div>
      )}
      <button className="btn btn-primary" style={{ marginBottom: "10px"}} onClick={openAddFFModal}>
              + Add Frequent Flyer Program
      </button>
      {/* Frequent Flyer Tab */}
      {activeTab === "frequent-flyers" && (
        <div>
          <div className="grid-2" style={{ marginBottom: "20px" }}>
            {isLoading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
            {!isLoading && !isError && data?.frequentFlyers.length === 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <EmptyState
                  icon="✈️"
                  title="No frequent flyer programs"
                  description="Add your first frequent flyer program to track miles and set redemption goals."
                />
              </div>
            )}
            {!isLoading && data?.frequentFlyers.map((ff) => (
              <div key={ff.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{ff.programName}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {ff.airlineName}
                      {ff.accountNumber && ` • ${ff.accountNumber}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => openHistoryForFrequentFlyer(ff.id)}
                    >
                      {openHistoryFFId === ff.id ? "Hide History" : "History"}
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => openEditFFModal(ff)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => confirmDeleteFrequentFlyer(ff.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: "12px" }}>
                  <div style={{ fontSize: "24px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                    {formatNumber(ff.currentMiles)}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                    miles
                    {ff.targetMiles && ` / ${formatNumber(ff.targetMiles)} goal`}
                  </div>
                </div>
                {ff.expirySummary.length > 0 && (
                  <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px" }}>
                    {ff.expirySummary.map((entry) => (
                      <div key={`${ff.id}-${entry.month}`} style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                        {entry.month}: {formatNumber(entry.amount)}
                      </div>
                    ))}
                  </div>
                )}
                {ff.targetMiles && (
                  <div className="prog-track" style={{ marginTop: "8px" }}>
                    <div
                      className="prog-bar"
                      style={{
                        width: `${Math.min((ff.currentMiles / ff.targetMiles) * 100, 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {openHistoryFFId && selectedHistoryFrequentFlyer && (
            <section className="card" style={{ marginTop: "20px", display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700 }}>Reward Points Transaction History</div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                    {selectedHistoryFrequentFlyer.programName}
                    {selectedHistoryFrequentFlyer.accountNumber ? ` • ${selectedHistoryFrequentFlyer.accountNumber}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setIsAddEarnModalOpen(true)}
                    title="Add Earn Transaction"
                    style={{ width: "28px", height: "28px", fontSize: "14px" }}
                  >
                    ➕
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setIsRedeemModalOpen(true)}
                    title="Redeem Miles"
                    style={{ width: "28px", height: "28px", fontSize: "14px" }}
                  >
                    ✈️
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={() => setOpenHistoryFFId(null)}>
                    Close
                  </button>
                </div>
              </div>

              {historyQuery.isLoading && (
                <div className="grid-2">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              )}

              {historyQuery.isError && (
                <div style={{ fontSize: "12px", color: "var(--error-500)" }}>
                  {(historyQuery.error as Error).message || "Failed to load transaction history"}
                </div>
              )}

              {historyQuery.data && (
                <>
                  <div className="grid-3" style={{ gap: "10px" }}>
                    <div className="card-sm" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                      <div className="stat-label">Total Earned</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                        {formatNumber(historyQuery.data.totals.earned)}
                      </div>
                    </div>
                    <div className="card-sm" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                      <div className="stat-label">Total Redeemed</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                        {formatNumber(historyQuery.data.totals.redeemed)}
                      </div>
                    </div>
                    <div className="card-sm" style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                      <div className="stat-label">Available Miles</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                        {formatNumber(historyQuery.data.totals.available)}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>Earn Transactions</div>
                      {earnEntries.length > EARN_PAGE_SIZE && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setEarnPage((p) => Math.max(1, p - 1))}
                            disabled={safeEarnPage <= 1}
                          >
                            Prev
                          </button>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                            {safeEarnPage}/{earnTotalPages}
                          </div>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setEarnPage((p) => Math.min(earnTotalPages, p + 1))}
                            disabled={safeEarnPage >= earnTotalPages}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                    {!earnEntries.length && (
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No earn transactions yet.</div>
                    )}
                    {pagedEarnEntries.map((entry) => (
                      <div key={entry.id} className="card-sm" style={{ display: "grid", gap: "8px" }}>
                        {editingEarnId === entry.id ? (
                          <div className="crud-edit" style={{ gridTemplateColumns: "140px 140px 1fr 140px auto auto" }}>
                            <input
                              className="input"
                              type="date"
                              value={editingEarnDate}
                              onChange={(e) => setEditingEarnDate(e.target.value)}
                            />
                            <input
                              className="input"
                              type="number"
                              min="1"
                              value={editingEarnMiles}
                              onChange={(e) => setEditingEarnMiles(e.target.value)}
                            />
                            <input
                              className="input"
                              type="text"
                              value={editingEarnTitle}
                              onChange={(e) => setEditingEarnTitle(e.target.value)}
                            />
                            <input
                              className="input"
                              type="date"
                              value={editingEarnExpiryDate}
                              onChange={(e) => setEditingEarnExpiryDate(e.target.value)}
                            />
                            <button
                              className="btn btn-secondary btn-xs"
                              onClick={() =>
                                updateEarnTransaction.mutate({
                                  frequentFlyerId: selectedHistoryFrequentFlyer.id,
                                  id: entry.id,
                                  date: editingEarnDate,
                                  miles: parseInt(editingEarnMiles || "0", 10),
                                  title: editingEarnTitle || undefined,
                                  expiryDate: editingEarnExpiryDate || undefined,
                                })
                              }
                            >
                              Save
                            </button>
                            <button className="btn btn-ghost btn-xs" onClick={() => setEditingEarnId(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <div>
                              <div style={{ fontSize: "12px", fontWeight: 600 }}>
                                {entry.title || "Miles credit"} • {toDateInputValue(entry.date)}
                              </div>
                              <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--brand-500)" }}>
                                {formatNumber(entry.miles)} miles earned
                              </div>
                              <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                                {(() => {
                                  const expired = isExpiredAtToday(entry.expiryDate);
                                  const availableMiles = expired ? 0 : entry.balanceMiles;
                                  return `${formatNumber(availableMiles)} available`;
                                })()}
                                {entry.expiryDate ? ` • expires ${toDateInputValue(entry.expiryDate)}` : ""}
                              </div>
                            </div>
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => {
                                setEditingEarnId(entry.id);
                                setEditingEarnDate(toDateInputValue(entry.date));
                                setEditingEarnMiles(String(entry.miles));
                                setEditingEarnTitle(entry.title || "");
                                setEditingEarnExpiryDate(entry.expiryDate ? toDateInputValue(entry.expiryDate) : "");
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {earnEntries.length > EARN_PAGE_SIZE && (
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textAlign: "right" }}>
                        Showing {(safeEarnPage - 1) * EARN_PAGE_SIZE + 1}-{Math.min(safeEarnPage * EARN_PAGE_SIZE, earnEntries.length)} of {earnEntries.length}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>Redemption Transactions</div>
                      {redemptionEntries.length > REDEMPTION_PAGE_SIZE && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setRedemptionPage((p) => Math.max(1, p - 1))}
                            disabled={safeRedemptionPage <= 1}
                          >
                            Prev
                          </button>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                            {safeRedemptionPage}/{redemptionTotalPages}
                          </div>
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setRedemptionPage((p) => Math.min(redemptionTotalPages, p + 1))}
                            disabled={safeRedemptionPage >= redemptionTotalPages}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                    {!redemptionEntries.length && (
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No redemption transactions yet.</div>
                    )}
                    {pagedRedemptionEntries.map((entry) => (
                      <div key={entry.id} className="card-sm" style={{ display: "grid", gap: "4px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600 }}>
                          {entry.redemptionTitle} • {toDateInputValue(entry.dateTime)}
                        </div>
                        <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--brand-500)" }}>
                          {formatNumber(entry.totalMilesRedeemed)} miles redeemed
                        </div>
                      </div>
                    ))}
                    {redemptionEntries.length > REDEMPTION_PAGE_SIZE && (
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textAlign: "right" }}>
                        Showing {(safeRedemptionPage - 1) * REDEMPTION_PAGE_SIZE + 1}-{Math.min(safeRedemptionPage * REDEMPTION_PAGE_SIZE, redemptionEntries.length)} of {redemptionEntries.length}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {/* Conversions Tab */}
      {activeTab === "conversions" && (
        <div>
          <div style={{ marginBottom: "20px" }}>
            {isLoading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}
            {!isLoading && !isError && data?.conversions.map((conv) => (
              <div key={conv.id} className="card" style={{ marginBottom: "8px" }}>
                {editingConversionId === conv.id ? (
                  <div className="crud-edit" style={{ gridTemplateColumns: "140px 140px 1fr auto auto" }}>
                    <input
                      type="number"
                      min="1"
                      className="input"
                      value={editingConvPoints}
                      onChange={(e) => setEditingConvPoints(e.target.value)}
                    />
                    <input
                      type="number"
                      min="1"
                      className="input"
                      value={editingConvMiles}
                      onChange={(e) => setEditingConvMiles(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input"
                      value={editingConvDesc}
                      onChange={(e) => setEditingConvDesc(e.target.value)}
                      placeholder="Description"
                    />
                    <button
                      className="btn btn-secondary btn-xs"
                      onClick={() =>
                        updateConversion.mutate({
                          id: conv.id,
                          fromPoints: parseInt(editingConvPoints || "0"),
                          toMiles: parseInt(editingConvMiles || "0"),
                          description: editingConvDesc || undefined,
                        })
                      }
                    >
                      Save
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => setEditingConversionId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>
                        {conv.creditCardReward?.creditCard.cardName || "Card rewards"} → {conv.frequentFlyer?.programName || "Miles"}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                        {formatNumber(conv.fromPoints)} points → {formatNumber(conv.toMiles)} miles
                        {conv.description && ` • ${conv.description}`}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", display: "grid", gap: "6px", justifyItems: "end" }}>
                      <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--brand-500)" }}>
                        {conv.conversionRate.toFixed(3)}x
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => beginEditConversion(conv)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => confirmDeleteConversion(conv.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!isLoading && !isError && !data?.conversions.length && (
              <EmptyState
                icon="🔄"
                title="No conversions yet"
                description="Add a conversion rate between credit card points and frequent flyer miles."
              />
            )}
          </div>

          {data?.creditCards.length && data?.frequentFlyers.length ? (
            <form className="card" onSubmit={onCreateConversion}>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>
                Add Conversion Rate
              </div>
              <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
                <select
                  className="input"
                  value={convCardId}
                  onChange={(e) => setConvCardId(e.target.value)}
                  required
                >
                  <option value="">From card...</option>
                  {data.creditCards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.creditCard.cardName}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={convFFId}
                  onChange={(e) => setConvFFId(e.target.value)}
                  required
                >
                  <option value="">To program...</option>
                  {data.frequentFlyers.map((ff) => (
                    <option key={ff.id} value={ff.id}>
                      {ff.programName}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className="input"
                  placeholder="Points"
                  value={convPoints}
                  onChange={(e) => setConvPoints(e.target.value)}
                  required
                />
                <input
                  type="number"
                  className="input"
                  placeholder="Miles"
                  value={convMiles}
                  onChange={(e) => setConvMiles(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createConversion.isPending}
                >
                  Add
                </button>
              </div>
              <input
                type="text"
                className="input"
                placeholder="Description (optional)"
                value={convDesc}
                onChange={(e) => setConvDesc(e.target.value)}
                style={{ marginTop: "8px" }}
              />
            </form>
          ) : (
            <div className="card" style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
              Add at least one credit card reward and one frequent flyer program to create conversions.
            </div>
          )}
        </div>
      )}

      {/* Frequent Flyer Modal */}
      {isFFModalOpen && (
        <div className="st-modal-overlay" onClick={closeFFModal}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>{editingFFId ? "Edit Frequent Flyer Program" : "Add Frequent Flyer Program"}</h3>
              <button className="st-close-btn" onClick={closeFFModal}>
                ✕
              </button>
            </div>
            <form className="st-modal-form" onSubmit={onSubmitFF}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Program Name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g., KrisFlyer"
                    value={ffFormProgram}
                    onChange={(e) => setFFFormProgram(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Airline Name</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g., Singapore Airlines"
                    value={ffFormAirline}
                    onChange={(e) => setFFFormAirline(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Account Number</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="Optional"
                    value={ffFormNumber}
                    onChange={(e) => setFFFormNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Current Miles</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={ffFormMiles}
                    onChange={(e) => setFFFormMiles(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Target Miles</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder="Optional"
                    value={ffFormTarget}
                    onChange={(e) => setFFFormTarget(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Expiry Warning (months)</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="24"
                    value={ffFormExpiry}
                    onChange={(e) => setFFFormExpiry(e.target.value)}
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Notes</label>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Optional notes..."
                    value={ffFormNotes}
                    onChange={(e) => setFFFormNotes(e.target.value)}
                  />
                </div>
              </div>
              {(createFrequentFlyer.isError || updateFrequentFlyer.isError) && (
                <div className="st-error">
                  {((createFrequentFlyer.error || updateFrequentFlyer.error) as Error)?.message || "Failed to save"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeFFModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createFrequentFlyer.isPending || updateFrequentFlyer.isPending}
                >
                  {editingFFId
                    ? updateFrequentFlyer.isPending
                      ? "Saving..."
                      : "Save Changes"
                    : createFrequentFlyer.isPending
                      ? "Adding..."
                      : "Add Program"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Earn Transaction Modal */}
      {isAddEarnModalOpen && selectedHistoryFrequentFlyer && (
        <div className="st-modal-overlay" onClick={() => setIsAddEarnModalOpen(false)}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Earn Transaction</h3>
              <button className="st-close-btn" onClick={() => setIsAddEarnModalOpen(false)}>
                ✕
              </button>
            </div>
            <form
              className="st-modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!openHistoryFFId || !earnMiles || !earnDate) return;
                createEarnTransaction.mutate({
                  frequentFlyerId: openHistoryFFId,
                  date: earnDate,
                  miles: parseInt(earnMiles, 10),
                  title: earnTitle || undefined,
                  expiryDate: earnExpiryDate || undefined,
                });
              }}
            >
              <div className="st-form-grid">
                <div className="form-group">
                  <label className="label">Date</label>
                  <input
                    className="input"
                    type="date"
                    value={earnDate}
                    onChange={(e) => setEarnDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Miles Earned</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    placeholder="0"
                    value={earnMiles}
                    onChange={(e) => setEarnMiles(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Title (optional)</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g., Flight credit, Bonus miles"
                    value={earnTitle}
                    onChange={(e) => setEarnTitle(e.target.value)}
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Expiry Date (optional)</label>
                  <input
                    className="input"
                    type="date"
                    value={earnExpiryDate}
                    onChange={(e) => setEarnExpiryDate(e.target.value)}
                  />
                </div>
              </div>
              {createEarnTransaction.isError && (
                <div className="st-error">
                  {(createEarnTransaction.error as Error)?.message || "Failed to add transaction"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setIsAddEarnModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createEarnTransaction.isPending}
                >
                  {createEarnTransaction.isPending ? "Saving..." : "Add Transaction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Redeem Miles Modal */}
      {isRedeemModalOpen && selectedHistoryFrequentFlyer && (
        <div className="st-modal-overlay" onClick={() => setIsRedeemModalOpen(false)}>
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Redeem Miles</h3>
              <button className="st-close-btn" onClick={() => setIsRedeemModalOpen(false)}>
                ✕
              </button>
            </div>
            <form
              className="st-modal-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!openHistoryFFId || !redeemMiles || !redeemDate || !redeemTitle) return;
                createRedeemTransaction.mutate({
                  frequentFlyerId: openHistoryFFId,
                  date: redeemDate,
                  redemptionTitle: redeemTitle,
                  milesToRedeem: parseInt(redeemMiles, 10),
                });
              }}
            >
              <div className="st-form-grid">
                <div className="form-group">
                  <label className="label">Date</label>
                  <input
                    className="input"
                    type="date"
                    value={redeemDate}
                    onChange={(e) => setRedeemDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Miles to Redeem</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    placeholder="0"
                    value={redeemMiles}
                    onChange={(e) => setRedeemMiles(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Redemption Title</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g., Flight award, Upgrade"
                    value={redeemTitle}
                    onChange={(e) => setRedeemTitle(e.target.value)}
                    required
                  />
                </div>
              </div>
              {createRedeemTransaction.isError && (
                <div className="st-error">
                  {(createRedeemTransaction.error as Error)?.message || "Failed to redeem miles"}
                </div>
              )}
              <div className="st-modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setIsRedeemModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createRedeemTransaction.isPending}
                >
                  {createRedeemTransaction.isPending ? "Redeeming..." : "Redeem Miles"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
