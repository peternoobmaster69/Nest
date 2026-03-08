"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, normalizeCurrency } from "@/lib/currency";
import { FormEvent, useState } from "react";

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

  const [newFFProgram, setNewFFProgram] = useState("");
  const [newFFAirline, setNewFFAirline] = useState("");
  const [newFFNumber, setNewFFNumber] = useState("");
  const [newFFMiles, setNewFFMiles] = useState("");
  const [newFFTarget, setNewFFTarget] = useState("");

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

  const { data, isLoading } = useQuery({
    queryKey: ["rewards"],
    queryFn: fetchRewards,
    initialData: {
      creditCards: initialCreditCards,
      frequentFlyers: initialFrequentFlyers,
      conversions: initialConversions,
      cardsWithoutRewards: availableCards,
    },
  });

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
    }) =>
      fetch("/api/rewards/frequent-flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setNewFFProgram("");
      setNewFFAirline("");
      setNewFFNumber("");
      setNewFFMiles("");
      setNewFFTarget("");
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

  const onCreateFrequentFlyer = (e: FormEvent) => {
    e.preventDefault();
    if (!newFFProgram || !newFFAirline) return;
    createFrequentFlyer.mutate({
      programName: newFFProgram,
      airlineName: newFFAirline,
      accountNumber: newFFNumber || undefined,
      currentMiles: parseInt(newFFMiles) || 0,
      targetMiles: newFFTarget ? parseInt(newFFTarget) : undefined,
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

  return (
    <div>
      {/* Summary Stats */}
      <section className="stat-card" style={{ marginBottom: "20px", display: "grid", gap: "12px" }}>
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
      </section>

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
            {data?.creditCards.map((card) => (
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
                    onClick={() => deleteCardReward.mutate(card.id)}
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

      {/* Frequent Flyer Tab */}
      {activeTab === "frequent-flyers" && (
        <div>
          <div className="grid-2" style={{ marginBottom: "20px" }}>
            {data?.frequentFlyers.map((ff) => (
              <div key={ff.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{ff.programName}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {ff.airlineName}
                      {ff.accountNumber && ` • ${ff.accountNumber}`}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => deleteFrequentFlyer.mutate(ff.id)}
                  >
                    Remove
                  </button>
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

          <form className="card" onSubmit={onCreateFrequentFlyer}>
            <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>
              Add Frequent Flyer Program
            </div>
            <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
              <input
                type="text"
                className="input"
                placeholder="Program name (e.g., KrisFlyer)"
                value={newFFProgram}
                onChange={(e) => setNewFFProgram(e.target.value)}
                required
              />
              <input
                type="text"
                className="input"
                placeholder="Airline name (e.g., Singapore Airlines)"
                value={newFFAirline}
                onChange={(e) => setNewFFAirline(e.target.value)}
                required
              />
              <input
                type="text"
                className="input"
                placeholder="Account number (optional)"
                value={newFFNumber}
                onChange={(e) => setNewFFNumber(e.target.value)}
              />
              <input
                type="number"
                className="input"
                placeholder="Current miles"
                value={newFFMiles}
                onChange={(e) => setNewFFMiles(e.target.value)}
              />
              <input
                type="number"
                className="input"
                placeholder="Target miles (optional)"
                value={newFFTarget}
                onChange={(e) => setNewFFTarget(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={createFrequentFlyer.isPending}
              >
                Add Program
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Conversions Tab */}
      {activeTab === "conversions" && (
        <div>
          <div style={{ marginBottom: "20px" }}>
            {data?.conversions.map((conv) => (
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
                          onClick={() => deleteConversion.mutate(conv.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!data?.conversions.length && (
              <div className="card" style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
                No conversions yet. Add a conversion rate between credit card points and miles.
              </div>
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
    </div>
  );
}
