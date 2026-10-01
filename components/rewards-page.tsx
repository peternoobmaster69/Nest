"use client";

import { workspaceFetch } from "@/lib/workspace-client";
import { apiFetch } from "@/lib/api/client";
import type { ListEnvelope } from "@/lib/api/contracts";
import { useWorkspaceId } from "@/components/workspace-provider";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeCurrency } from "@/lib/currency";
import { useMoneyFormat } from "@/lib/use-money-format";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { FormEvent, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui-skeleton";
import { RewardsCardGridSkeleton, RewardsRowsSkeleton } from "@/components/skeletons/RewardsSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { ArrowLeftRight, Building2, CreditCard, Plane, Plus } from "lucide-react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { RewardsOverview } from "@/components/rewards/rewards-overview";
import { useSearchParams } from "next/navigation";
import { useUrlFilterSync } from "@/lib/use-url-filter-sync";

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
  mileNeverExpire: boolean;
  validityPeriodYears: number;
  notes: string | null;
  isActive: boolean;
  expirySummary: Array<{
    month: string;
    amount: number;
  }>;
};

type HotelReward = {
  id: string;
  programName: string;
  hotelBrand: string;
  accountNumber: string | null;
  currentPoints: number;
  targetPoints: number | null;
  centsPerPoint: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  milePrograms: ListEnvelope<MileProgramHistory>;
  redemptions: ListEnvelope<MileRedemptionHistory>;
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
  workspaceName?: string | null;
  role?: "OWNER" | "EDITOR" | "VIEWER";
  baseCurrency?: string | null;
};

async function fetchRewards(): Promise<{
  creditCards: CreditCardReward[];
  frequentFlyers: FrequentFlyer[];
  hotelRewards: HotelReward[];
  conversions: PointConversion[];
  cardsWithoutRewards: AvailableCard[];
}> {
  const res = await workspaceFetch("/api/rewards");
  if (!res.ok) throw new Error("Failed to fetch rewards");
  return res.json();
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

function hotelPointValueCents(points: number, centsPerPoint: number): number {
  return Math.round(points * centsPerPoint);
}

function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

function todayDateInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function calculateExpiryDateInputValue(dateValue: string, years: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const expiryDate = new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth() + 1, 0));
  return expiryDate.toISOString().slice(0, 10);
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
  initialHotelRewards,
  initialConversions,
  availableCards,
}: {
  initialCreditCards: CreditCardReward[];
  initialFrequentFlyers: FrequentFlyer[];
  initialHotelRewards: HotelReward[];
  initialConversions: PointConversion[];
  availableCards: AvailableCard[];
}) {
  const routeWorkspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const rewardsUrlKey = searchParams.toString();
  const [activeTab, setActiveTab] = useState<"credit-cards" | "frequent-flyers" | "hotel-rewards" | "conversions">("credit-cards");
  const [hydratedRewardsUrlKey, setHydratedRewardsUrlKey] = useState<string | null>(null);
  const urlTabReady = hydratedRewardsUrlKey === rewardsUrlKey;

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "credit-cards" || tab === "frequent-flyers" || tab === "hotel-rewards" || tab === "conversions") {
      setActiveTab(tab);
    }
    setHydratedRewardsUrlKey(rewardsUrlKey);
  }, [rewardsUrlKey, searchParams]);

  useUrlFilterSync({ tab: activeTab }, urlTabReady);

  // Forms state
  const [newCardId, setNewCardId] = useState("");
  const [newCardPoints, setNewCardPoints] = useState("");
  const [newCardValue, setNewCardValue] = useState("");
  const [newCardConvPoints, setNewCardConvPoints] = useState("10000");
  const [newCardConvMiles, setNewCardConvMiles] = useState("4000");
  const [newCardConvDesc, setNewCardConvDesc] = useState("");
  const [isCardRewardModalOpen, setIsCardRewardModalOpen] = useState(false);


  const [convCardId, setConvCardId] = useState("");
  const [convFFId, setConvFFId] = useState("");
  const [convPoints, setConvPoints] = useState("");
  const [convMiles, setConvMiles] = useState("");
  const [convDesc, setConvDesc] = useState("");
  const [isConversionModalOpen, setIsConversionModalOpen] = useState(false);
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
  const [ffFormMileNeverExpire, setFFFormMileNeverExpire] = useState(false);
  const [ffFormValidityPeriodYears, setFFFormValidityPeriodYears] = useState("3");
  const [ffFormNotes, setFFFormNotes] = useState("");
  const [openHistoryFFId, setOpenHistoryFFId] = useState<string | null>(null);
  const rewardsTopRef = useRef<HTMLDivElement>(null);
  const historySectionRef = useRef<HTMLElement>(null);
  const closeHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [earnDate, setEarnDate] = useState(todayDateInputValue);
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
  const [isHotelModalOpen, setIsHotelModalOpen] = useState(false);
  const [editingHotelId, setEditingHotelId] = useState<string | null>(null);
  const [hotelFormProgram, setHotelFormProgram] = useState("");
  const [hotelFormBrand, setHotelFormBrand] = useState("");
  const [hotelFormNumber, setHotelFormNumber] = useState("");
  const [hotelFormPoints, setHotelFormPoints] = useState("");
  const [hotelFormTarget, setHotelFormTarget] = useState("");
  const [hotelFormCentsPerPoint, setHotelFormCentsPerPoint] = useState("");
  const [hotelFormNotes, setHotelFormNotes] = useState("");

  const context = useQuery({
    queryKey: queryKeys.key(["app-context", routeWorkspaceId]),
    queryFn: async () => {
      const res = await workspaceFetch("/api/context");
      if (!res.ok) throw new Error("Failed to fetch context");
      return res.json() as Promise<AppContext>;
    },
  });
  const baseCurrency = normalizeCurrency(context.data?.baseCurrency);
  const { format: formatMoneyValue } = useMoneyFormat(baseCurrency);
  const formatCurrency = (cents: number | null): string => formatMoneyValue(cents ?? 0);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.key(["rewards", routeWorkspaceId]),
    queryFn: fetchRewards,
    initialData: {
      creditCards: initialCreditCards,
      frequentFlyers: initialFrequentFlyers,
      hotelRewards: initialHotelRewards,
      conversions: initialConversions,
      cardsWithoutRewards: availableCards,
    },
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.rewardHistory(routeWorkspaceId, openHistoryFFId),
    queryFn: async (): Promise<FrequentFlyerHistoryResponse> => {
      if (!openHistoryFFId) {
        throw new Error("Frequent flyer is required");
      }
      return apiFetch<FrequentFlyerHistoryResponse>(
        `/api/rewards/frequent-flyer/history?frequentFlyerId=${encodeURIComponent(openHistoryFFId)}&limit=100`,
      );
    },
    enabled: !!openHistoryFFId,
  });

  useEffect(() => {
    setEarnPage(1);
    setRedemptionPage(1);
  }, [openHistoryFFId]);

  useEffect(() => {
    if (!openHistoryFFId) return;
    const frame = requestAnimationFrame(() => {
      historySectionRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [openHistoryFFId]);

  useEffect(() => () => {
    if (closeHistoryTimerRef.current) clearTimeout(closeHistoryTimerRef.current);
  }, []);

  const createCardReward = useMutation({
    mutationFn: (payload: {
      creditCardId: string;
      currentPoints: number;
      pointsValueCents?: number;
      conversionFromPoints: number;
      conversionToMiles: number;
      conversionDescription?: string;
    }) =>
      workspaceFetch("/api/rewards/credit-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
      closeCardRewardModal();
    },
  });

  const updateCardReward = useMutation({
    mutationFn: (payload: { id: string; currentPoints: number; pointsValueCents?: number }) =>
      workspaceFetch("/api/rewards/credit-card", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
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
      mileNeverExpire: boolean;
      validityPeriodYears: number;
      notes?: string;
    }) =>
      workspaceFetch("/api/rewards/frequent-flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
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
      mileNeverExpire: boolean;
      validityPeriodYears: number;
      notes?: string;
    }) =>
      workspaceFetch("/api/rewards/frequent-flyer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
      closeFFModal();
    },
  });

  const createHotelReward = useMutation({
    mutationFn: (payload: {
      programName: string;
      hotelBrand: string;
      accountNumber?: string;
      currentPoints: number;
      targetPoints?: number | null;
      centsPerPoint: number;
      notes?: string;
    }) =>
      workspaceFetch("/api/rewards/hotel-rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
      closeHotelModal();
    },
  });

  const updateHotelReward = useMutation({
    mutationFn: (payload: {
      id: string;
      programName: string;
      hotelBrand: string;
      accountNumber?: string;
      currentPoints: number;
      targetPoints?: number | null;
      centsPerPoint: number;
      notes?: string;
    }) =>
      workspaceFetch("/api/rewards/hotel-rewards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
      closeHotelModal();
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
      workspaceFetch("/api/rewards/conversion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
      closeConversionModal();
    },
  });

  const deleteCardReward = useMutation({
    mutationFn: (id: string) => workspaceFetch(`/api/rewards/credit-card?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) }),
  });

  const deleteFrequentFlyer = useMutation({
    mutationFn: (id: string) => workspaceFetch(`/api/rewards/frequent-flyer?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) }),
  });

  const deleteHotelReward = useMutation({
    mutationFn: (id: string) => workspaceFetch(`/api/rewards/hotel-rewards?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) }),
  });

  const deleteConversion = useMutation({
    mutationFn: (id: string) => workspaceFetch(`/api/rewards/conversion?id=${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) }),
  });

  const updateConversion = useMutation({
    mutationFn: (payload: { id: string; fromPoints: number; toMiles: number; description?: string }) =>
      workspaceFetch("/api/rewards/conversion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
      setEditingConversionId(null);
      setEditingConvPoints("");
      setEditingConvMiles("");
      setEditingConvDesc("");
    },
  });

  const refreshRewardsAndHistory = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.key(["rewards"]) });
    if (openHistoryFFId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.key(["rewards", routeWorkspaceId, "frequent-flyer-history", openHistoryFFId]),
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
      const res = await workspaceFetch("/api/rewards/frequent-flyer/history", {
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
      const res = await workspaceFetch("/api/rewards/frequent-flyer/history", {
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
      const res = await workspaceFetch("/api/rewards/frequent-flyer/history", {
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

  const resetCardRewardForm = () => {
    setNewCardId("");
    setNewCardPoints("");
    setNewCardValue("");
    setNewCardConvPoints("10000");
    setNewCardConvMiles("4000");
    setNewCardConvDesc("");
  };

  const openCardRewardModal = () => {
    resetCardRewardForm();
    setIsCardRewardModalOpen(true);
  };

  const closeCardRewardModal = () => {
    setIsCardRewardModalOpen(false);
    resetCardRewardForm();
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

  const resetConversionForm = () => {
    setConvCardId("");
    setConvFFId("");
    setConvPoints("");
    setConvMiles("");
    setConvDesc("");
  };

  const openConversionModal = () => {
    resetConversionForm();
    setIsConversionModalOpen(true);
  };

  const closeConversionModal = () => {
    setIsConversionModalOpen(false);
    resetConversionForm();
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
    setFFFormMileNeverExpire(false);
    setFFFormValidityPeriodYears("3");
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
    setFFFormMileNeverExpire(ff.mileNeverExpire);
    setFFFormValidityPeriodYears(String(ff.validityPeriodYears));
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
      mileNeverExpire: ffFormMileNeverExpire,
      validityPeriodYears: parseInt(ffFormValidityPeriodYears, 10) || 3,
      notes: ffFormNotes || undefined,
    };
    if (editingFFId) {
      updateFrequentFlyer.mutate({ id: editingFFId, ...payload });
    } else {
      createFrequentFlyer.mutate(payload);
    }
  };

  const resetHotelForm = () => {
    setHotelFormProgram("");
    setHotelFormBrand("");
    setHotelFormNumber("");
    setHotelFormPoints("");
    setHotelFormTarget("");
    setHotelFormCentsPerPoint("");
    setHotelFormNotes("");
  };

  const closeHotelModal = () => {
    setIsHotelModalOpen(false);
    setEditingHotelId(null);
    resetHotelForm();
  };

  const openAddHotelModal = () => {
    setEditingHotelId(null);
    resetHotelForm();
    setIsHotelModalOpen(true);
  };

  const openEditHotelModal = (hotel: HotelReward) => {
    setEditingHotelId(hotel.id);
    setHotelFormProgram(hotel.programName);
    setHotelFormBrand(hotel.hotelBrand);
    setHotelFormNumber(hotel.accountNumber || "");
    setHotelFormPoints(String(hotel.currentPoints));
    setHotelFormTarget(hotel.targetPoints && hotel.targetPoints > 0 ? String(hotel.targetPoints) : "");
    setHotelFormCentsPerPoint(String(hotel.centsPerPoint));
    setHotelFormNotes(hotel.notes || "");
    setIsHotelModalOpen(true);
  };

  const onSubmitHotel = (e: FormEvent) => {
    e.preventDefault();
    if (!hotelFormProgram || !hotelFormBrand || !hotelFormPoints || !hotelFormCentsPerPoint) return;
    const targetPoints = hotelFormTarget.trim() === "" ? null : parseInt(hotelFormTarget, 10);
    const payload = {
      programName: hotelFormProgram,
      hotelBrand: hotelFormBrand,
      accountNumber: hotelFormNumber || undefined,
      currentPoints: parseInt(hotelFormPoints, 10) || 0,
      targetPoints: targetPoints && targetPoints > 0 ? targetPoints : null,
      centsPerPoint: parseFloat(hotelFormCentsPerPoint) || 0,
      notes: hotelFormNotes || undefined,
    };
    if (editingHotelId) {
      updateHotelReward.mutate({ id: editingHotelId, ...payload });
    } else {
      createHotelReward.mutate(payload);
    }
  };

  const openHistoryForFrequentFlyer = (frequentFlyerId: string) => {
    if (openHistoryFFId === frequentFlyerId) {
      closeHistoryAndScrollToTop();
      return;
    }
    if (closeHistoryTimerRef.current) {
      clearTimeout(closeHistoryTimerRef.current);
      closeHistoryTimerRef.current = null;
    }
    setOpenHistoryFFId(frequentFlyerId);
    setEditingEarnId(null);
  };

  const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const closeHistoryAndScrollToTop = () => {
    setEditingEarnId(null);
    const rewardsTop = rewardsTopRef.current;
    const scrollContainer = rewardsTop?.closest(".body");
    const reduceMotion = prefersReducedMotion();

    if (!rewardsTop) {
      setOpenHistoryFFId(null);
      return;
    }

    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    } else {
      rewardsTop.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }

    if (closeHistoryTimerRef.current) clearTimeout(closeHistoryTimerRef.current);
    if (reduceMotion || (scrollContainer instanceof HTMLElement && scrollContainer.scrollTop <= 2)) {
      setOpenHistoryFFId(null);
      closeHistoryTimerRef.current = null;
      return;
    }

    closeHistoryTimerRef.current = setTimeout(() => {
      setOpenHistoryFFId(null);
      closeHistoryTimerRef.current = null;
    }, 450);
  };

  const confirmDeleteCardReward = async (id: string) => {
    if (!(await confirmDestructiveAction("Delete this credit card rewards record?", "Delete rewards record?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "This rewards balance cannot be restored automatically.",
    }))) return;
    deleteCardReward.mutate(id);
  };

  const confirmDeleteFrequentFlyer = async (id: string) => {
    if (!(await confirmDestructiveAction("Delete this frequent flyer account?", "Delete frequent flyer account?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "This account and its tracked miles cannot be restored automatically.",
    }))) return;
    deleteFrequentFlyer.mutate(id);
  };

  const confirmDeleteHotelReward = async (id: string) => {
    if (!(await confirmDestructiveAction("Delete this hotel rewards account?", "Delete hotel rewards account?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "This account cannot be restored automatically.",
    }))) return;
    deleteHotelReward.mutate(id);
  };

  const confirmDeleteConversion = async (id: string) => {
    if (!(await confirmDestructiveAction("Delete this conversion rate?", "Delete conversion rate?", {
      workspace: { name: context.data?.workspaceName || "Current workspace", role: context.data?.role || "EDITOR" },
      reversal: "You can add the conversion again later, but this saved rate will be removed.",
    }))) return;
    deleteConversion.mutate(id);
  };

  const totalMiles = data?.frequentFlyers.reduce((sum, f) => sum + f.currentMiles, 0) || 0;
  const totalHotelPoints = data?.hotelRewards.reduce((sum, hotel) => sum + hotel.currentPoints, 0) || 0;
  const totalHotelValueCents =
    data?.hotelRewards.reduce((sum, hotel) => sum + hotelPointValueCents(hotel.currentPoints, hotel.centsPerPoint), 0) || 0;
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
  const earnEntries = historyQuery.data?.milePrograms.items ?? [];
  const redemptionEntries = historyQuery.data?.redemptions.items ?? [];
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

  useEffect(() => {
    if (!isAddEarnModalOpen || !selectedHistoryFrequentFlyer) return;
    if (selectedHistoryFrequentFlyer.mileNeverExpire) {
      setEarnExpiryDate("");
      return;
    }
    setEarnExpiryDate(
      calculateExpiryDateInputValue(earnDate, selectedHistoryFrequentFlyer.validityPeriodYears),
    );
  }, [
    earnDate,
    isAddEarnModalOpen,
    selectedHistoryFrequentFlyer,
  ]);

  const activeTabAction =
    activeTab === "credit-cards" && data?.cardsWithoutRewards.length ? (
      <Button className="btn btn-primary rewards-tab-action" onClick={openCardRewardModal}>
        <Plus size={16} aria-hidden="true" />
        Add card rewards
      </Button>
    ) : activeTab === "frequent-flyers" ? (
      <Button className="btn btn-primary rewards-tab-action" onClick={openAddFFModal}>
        <Plus size={16} aria-hidden="true" />
        Add frequent flyer
      </Button>
    ) : activeTab === "hotel-rewards" ? (
      <Button className="btn btn-primary rewards-tab-action" onClick={openAddHotelModal}>
        <Plus size={16} aria-hidden="true" />
        Add hotel rewards
      </Button>
    ) : activeTab === "conversions" && data?.creditCards.length && data?.frequentFlyers.length ? (
      <Button className="btn btn-primary rewards-tab-action" onClick={openConversionModal}>
        <Plus size={16} aria-hidden="true" />
        Add conversion rate
      </Button>
    ) : null;

  return (
    <div ref={rewardsTopRef} className="rewards-page-top">
      {/* Summary Stats */}
      <RewardsOverview
        loading={isLoading}
        cardMiles={totalCreditCardMiles}
        cardCount={data?.creditCards.length ?? 0}
        frequentFlyerMiles={totalMiles}
        frequentFlyerCount={data?.frequentFlyers.length ?? 0}
        hotelPoints={totalHotelPoints}
        hotelCount={data?.hotelRewards.length ?? 0}
        hotelValue={totalHotelValueCents}
        combinedMiles={totalCombinedMiles}
        formatCurrency={formatCurrency}
      />

      {isError && (
        <div className="card" style={{ marginBottom: "20px" }}>
          <EmptyState
            icon="⚠️"
            title="Failed to load rewards"
            action={
              <Button className="btn btn-primary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {/* Tabs */}
      <div className="rewards-tabs-row">
        <div className="segmented rewards-tabs">
          <Button
            type="button"
            aria-label="Credit cards"
            className={`segmented-btn ${activeTab === "credit-cards" ? "on" : ""}`}
            onClick={() => setActiveTab("credit-cards")}
          >
            <CreditCard className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Credit cards</span>
          </Button>
          <Button
            type="button"
            aria-label="Frequent flyer"
            className={`segmented-btn ${activeTab === "frequent-flyers" ? "on" : ""}`}
            onClick={() => setActiveTab("frequent-flyers")}
          >
            <Plane className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Frequent flyer</span>
          </Button>
          <Button
            type="button"
            aria-label="Hotel rewards"
            className={`segmented-btn ${activeTab === "hotel-rewards" ? "on" : ""}`}
            onClick={() => setActiveTab("hotel-rewards")}
          >
            <Building2 className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Hotel rewards</span>
          </Button>
          <Button
            type="button"
            aria-label="Conversions"
            className={`segmented-btn ${activeTab === "conversions" ? "on" : ""}`}
            onClick={() => setActiveTab("conversions")}
          >
            <ArrowLeftRight className="rewards-tab-icon" size={16} aria-hidden="true" />
            <span className="rewards-tab-label">Conversions</span>
          </Button>
        </div>
        {activeTabAction}
      </div>

      {/* Credit Cards Tab */}
      {activeTab === "credit-cards" && (
        <div>
          <div className="rewards-cc-grid">
            {isLoading && <RewardsCardGridSkeleton />}
            {!isLoading && !isError && data?.creditCards.length === 0 && (
              <EmptyState
                icon="💳"
                title="No credit card rewards"
                description="Add your first credit card to start tracking rewards points and their conversion to miles."
              />
            )}
            {!isLoading && data?.creditCards.map((card) => (
              <div key={card.id} className="card rewards-item-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>
                      {card.creditCard.cardName} ••{card.creditCard.last4Digit}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {card.creditCard.bankName || "Unknown Bank"}
                    </div>
                  </div>
                  <Button
                    className="btn btn-ghost btn-xs"
                    onClick={() => confirmDeleteCardReward(card.id)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="rewards-item-balance">
                  <div className="rewards-item-value">
                    {formatNumber(card.currentPoints)}
                  </div>
                  <div className="rewards-item-accent">
                    {(() => {
                      const conversion = conversionByRewardId.get(card.id);
                      if (!conversion) return "Set conversion";
                      return `${formatNumber(Math.floor(card.currentPoints * conversion.conversionRate))} miles`;
                    })()}
                  </div>
                  <div className="rewards-item-meta">
                    points{" "}
                    {(() => {
                      const conversion = conversionByRewardId.get(card.id);
                      if (!conversion) return "• no conversion";
                      return `• ${conversion.fromPoints}:${conversion.toMiles}`;
                    })()}
                  </div>
                </div>
                {editingCardId === card.id ? (
                  <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <NumericCalculatorInput
                      min="0"
                      allowDecimal={false}
                      value={editingCardPoints}
                      onValueChange={setEditingCardPoints}
                      style={{ flex: "1 1 140px", minWidth: "120px" }}
                    />
                    <Button
                      className="btn btn-secondary btn-xs"
                      onClick={() =>
                        updateCardReward.mutate({
                          id: card.id,
                          currentPoints: parseInt(editingCardPoints || "0"),
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button className="btn btn-ghost btn-xs" onClick={() => setEditingCardId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div style={{ marginTop: "10px" }}>
                    <Button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setEditingCardId(card.id);
                        setEditingCardPoints(String(card.currentPoints));
                      }}
                    >
                      Edit Balance
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isLoading && !isError && data && data.creditCards.length > 0 && data.cardsWithoutRewards.length === 0 ? (
            <div className="card" style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
              All credit cards have rewards tracked. Add more cards to track their rewards.
            </div>
          ) : null}
        </div>
      )}
      {/* Frequent Flyer Tab */}
      {activeTab === "frequent-flyers" && (
        <div>
          <div className="grid-2 rewards-program-grid">
            {isLoading && <RewardsCardGridSkeleton />}
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
              <div key={ff.id} className="card rewards-item-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 600 }}>{ff.programName}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                      {ff.airlineName}
                      {ff.accountNumber && ` • ${ff.accountNumber}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <Button
                      className="btn btn-ghost btn-xs"
                      onClick={() => openHistoryForFrequentFlyer(ff.id)}
                    >
                      {openHistoryFFId === ff.id ? "Hide History" : "History"}
                    </Button>
                    <Button
                      className="btn btn-ghost btn-xs"
                      onClick={() => openEditFFModal(ff)}
                    >
                      Edit
                    </Button>
                    <Button
                      className="btn btn-ghost btn-xs"
                      onClick={() => confirmDeleteFrequentFlyer(ff.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="rewards-item-balance">
                  <div className="rewards-item-value">
                    {formatNumber(ff.currentMiles)}
                  </div>
                  <div className="rewards-item-meta">
                    miles
                    {ff.targetMiles && ` / ${formatNumber(ff.targetMiles)} goal`}
                    {` • ${ff.mileNeverExpire ? "never expires" : `valid ${ff.validityPeriodYears} years`}`}
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
            <section ref={historySectionRef} className="card rewards-history-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700 }}>Reward Points Transaction History</div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                    {selectedHistoryFrequentFlyer.programName}
                    {selectedHistoryFrequentFlyer.accountNumber ? ` • ${selectedHistoryFrequentFlyer.accountNumber}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setIsAddEarnModalOpen(true)}
                    title="Add Earn Transaction"
                    style={{ width: "28px", height: "28px", fontSize: "14px" }}
                  >
                    ➕
                  </Button>
                  <Button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setIsRedeemModalOpen(true)}
                    title="Redeem Miles"
                    style={{ width: "28px", height: "28px", fontSize: "14px" }}
                  >
                    ✈️
                  </Button>
                  <Button className="btn btn-ghost btn-xs" onClick={closeHistoryAndScrollToTop}>
                    Close
                  </Button>
                </div>
              </div>

              {historyQuery.isLoading && (
                <div className="grid-2">
                  <RewardsRowsSkeleton />
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
                          <Button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setEarnPage((p) => Math.max(1, p - 1))}
                            disabled={safeEarnPage <= 1}
                          >
                            Prev
                          </Button>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                            {safeEarnPage}/{earnTotalPages}
                          </div>
                          <Button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setEarnPage((p) => Math.min(earnTotalPages, p + 1))}
                            disabled={safeEarnPage >= earnTotalPages}
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </div>
                    {!earnEntries.length && (
                      <div className="card-sm" style={{ background: "var(--bg-subtle)", border: "1px dashed var(--border-default)" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "8px" }}>No earn transactions yet.</div>
                        <div style={{ display: "grid", gap: "6px", fontSize: "11px", color: "var(--text-disabled)" }}>
                          <div>Date — When miles were earned</div>
                          <div>Miles — Number of miles earned</div>
                          <div>Title — Description of the transaction</div>
                          <div>Expiry — When these miles expire</div>
                        </div>
                      </div>
                    )}
                    {pagedEarnEntries.map((entry) => (
                      <div key={entry.id} className="card-sm" style={{ display: "grid", gap: "8px" }}>
                        {editingEarnId === entry.id ? (
                          <div className="crud-edit" style={{ gridTemplateColumns: "140px 140px 1fr 140px auto auto" }}>
                            <Input
                              className="input"
                              type="date"
                              value={editingEarnDate}
                              onChange={(e) => setEditingEarnDate(e.target.value)}
                            />
                            <NumericCalculatorInput
                              min="1"
                              allowDecimal={false}
                              value={editingEarnMiles}
                              onValueChange={setEditingEarnMiles}
                            />
                            <Input
                              className="input"
                              type="text"
                              value={editingEarnTitle}
                              onChange={(e) => setEditingEarnTitle(e.target.value)}
                            />
                            <Input
                              className="input"
                              type="date"
                              value={editingEarnExpiryDate}
                              onChange={(e) => setEditingEarnExpiryDate(e.target.value)}
                            />
                            <Button
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
                            </Button>
                            <Button className="btn btn-ghost btn-xs" onClick={() => setEditingEarnId(null)}>
                              Cancel
                            </Button>
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
                            <Button
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
                            </Button>
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
                          <Button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setRedemptionPage((p) => Math.max(1, p - 1))}
                            disabled={safeRedemptionPage <= 1}
                          >
                            Prev
                          </Button>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                            {safeRedemptionPage}/{redemptionTotalPages}
                          </div>
                          <Button
                            className="btn btn-ghost btn-xs"
                            onClick={() => setRedemptionPage((p) => Math.min(redemptionTotalPages, p + 1))}
                            disabled={safeRedemptionPage >= redemptionTotalPages}
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </div>
                    {!redemptionEntries.length && (
                      <div className="card-sm" style={{ background: "var(--bg-subtle)", border: "1px dashed var(--border-default)" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "8px" }}>No redemption transactions yet.</div>
                        <div style={{ display: "grid", gap: "6px", fontSize: "11px", color: "var(--text-disabled)" }}>
                          <div>Title — Description of the redemption</div>
                          <div>Date — When miles were redeemed</div>
                          <div>Miles — Number of miles used</div>
                        </div>
                      </div>
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

      {/* Hotel Rewards Tab */}
      {activeTab === "hotel-rewards" && (
        <div>
          <div className="grid-2 rewards-program-grid">
            {isLoading && <RewardsCardGridSkeleton variant="hotel" />}
            {!isLoading && !isError && data?.hotelRewards.length === 0 && (
              <div style={{ gridColumn: "1 / -1" }}>
                <EmptyState
                  icon="H"
                  title="No hotel rewards programs"
                  description="Add your first hotel rewards program to track points, point value, and redemption goals."
                />
              </div>
            )}
            {!isLoading && data?.hotelRewards.map((hotel) => {
              const valueCents = hotelPointValueCents(hotel.currentPoints, hotel.centsPerPoint);
              return (
                <div key={hotel.id} className="card rewards-item-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{hotel.programName}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                        {hotel.hotelBrand}
                        {hotel.accountNumber && ` - ${hotel.accountNumber}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <Button
                        className="btn btn-ghost btn-xs"
                        onClick={() => openEditHotelModal(hotel)}
                      >
                        Edit
                      </Button>
                      <Button
                        className="btn btn-ghost btn-xs"
                        onClick={() => confirmDeleteHotelReward(hotel.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="rewards-item-balance">
                    <div className="rewards-item-value">
                      {formatNumber(hotel.currentPoints)}
                    </div>
                    <div className="rewards-item-accent">
                      {formatCurrency(valueCents)}
                    </div>
                    <div className="rewards-item-meta">
                      points
                      {hotel.targetPoints && hotel.targetPoints > 0 ? ` / ${formatNumber(hotel.targetPoints)} goal` : ""}
                      {` - ${Number(hotel.centsPerPoint).toFixed(3)}c per point`}
                    </div>
                  </div>
                  {hotel.targetPoints !== null && hotel.targetPoints > 0 ? (
                    <div className="prog-track" style={{ marginTop: "8px" }}>
                      <div
                        className="prog-bar"
                        style={{
                          width: `${Math.min((hotel.currentPoints / hotel.targetPoints) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Conversions Tab */}
      {activeTab === "conversions" && (
        <div>
          <div className="rewards-conversion-list">
            {isLoading && <RewardsRowsSkeleton />}
            {!isLoading && !isError && data?.conversions.map((conv) => (
              <div key={conv.id} className="card rewards-conversion-card">
                {editingConversionId === conv.id ? (
                  <div className="crud-edit" style={{ gridTemplateColumns: "140px 140px 1fr auto auto" }}>
                    <NumericCalculatorInput
                      min="1"
                      allowDecimal={false}
                      value={editingConvPoints}
                      onValueChange={setEditingConvPoints}
                    />
                    <NumericCalculatorInput
                      min="1"
                      allowDecimal={false}
                      value={editingConvMiles}
                      onValueChange={setEditingConvMiles}
                    />
                    <Input
                      type="text"
                      className="input"
                      value={editingConvDesc}
                      onChange={(e) => setEditingConvDesc(e.target.value)}
                      placeholder="Description"
                    />
                    <Button
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
                    </Button>
                    <Button className="btn btn-ghost btn-xs" onClick={() => setEditingConversionId(null)}>
                      Cancel
                    </Button>
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
                        {Number(conv.conversionRate).toFixed(3)}x
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <Button
                          className="btn btn-ghost btn-xs"
                          onClick={() => beginEditConversion(conv)}
                        >
                          Edit
                        </Button>
                        <Button
                          className="btn btn-ghost btn-xs"
                          onClick={() => confirmDeleteConversion(conv.id)}
                        >
                          Delete
                        </Button>
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

          {!isLoading && !isError && (!data?.creditCards.length || !data?.frequentFlyers.length) ? (
            <div className="card" style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
              Add at least one credit card reward and one frequent flyer program to create conversions.
            </div>
          ) : null}
        </div>
      )}

      {/* Credit Card Rewards Modal */}
      {isCardRewardModalOpen && data?.cardsWithoutRewards.length ? (
        <Dialog open onClose={closeCardRewardModal} title="Add card rewards" surface="custom" overlayClassName="st-modal-overlay">
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Credit Card Rewards</h3>
              <ModalCloseButton onClick={closeCardRewardModal} label="Close Add Credit Card Rewards" />
            </div>
            <form className="st-modal-form" onSubmit={onCreateCardReward}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label" htmlFor="reward-card-id">Card</label>
                  <Select
                    id="reward-card-id"
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
                  </Select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="reward-card-points">Current Points</label>
                  <NumericCalculatorInput
                    id="reward-card-points"
                    allowDecimal={false}
                    placeholder="0"
                    value={newCardPoints}
                    onValueChange={setNewCardPoints}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="reward-card-cash-value">Cash Value</label>
                  <NumericCalculatorInput
                    id="reward-card-cash-value"
                    step="0.01"
                    placeholder="0.00"
                    value={newCardValue}
                    onValueChange={setNewCardValue}
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="reward-card-conv-points">Conversion Points</label>
                  <NumericCalculatorInput
                    id="reward-card-conv-points"
                    allowDecimal={false}
                    placeholder="10000"
                    value={newCardConvPoints}
                    onValueChange={setNewCardConvPoints}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="reward-card-conv-miles">Conversion Miles</label>
                  <NumericCalculatorInput
                    id="reward-card-conv-miles"
                    allowDecimal={false}
                    placeholder="4000"
                    value={newCardConvMiles}
                    onValueChange={setNewCardConvMiles}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label" htmlFor="reward-card-conv-desc">Conversion Description</label>
                  <Input
                    id="reward-card-conv-desc"
                    type="text"
                    className="input"
                    placeholder="Optional notes"
                    value={newCardConvDesc}
                    onChange={(e) => setNewCardConvDesc(e.target.value)}
                  />
                </div>
              </div>
              {createCardReward.isError && (
                <div className="st-error">
                  {(createCardReward.error as Error)?.message || "Failed to add credit card rewards"}
                </div>
              )}
              <div className="st-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeCardRewardModal}>
                  Cancel
                </Button>
                <Button type="submit" className="btn btn-primary" disabled={createCardReward.isPending}>
                  {createCardReward.isPending ? "Adding..." : "Add Rewards"}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      ) : null}

      {/* Conversion Rate Modal */}
      {isConversionModalOpen && data?.creditCards.length && data?.frequentFlyers.length ? (
        <Dialog open onClose={closeConversionModal} title="Add point conversion" surface="custom" overlayClassName="st-modal-overlay">
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Conversion Rate</h3>
              <ModalCloseButton onClick={closeConversionModal} label="Close Add Conversion Rate" />
            </div>
            <form className="st-modal-form" onSubmit={onCreateConversion}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label" htmlFor="conversion-card-id">From Card</label>
                  <Select
                    id="conversion-card-id"
                    className="input"
                    value={convCardId}
                    onChange={(e) => setConvCardId(e.target.value)}
                    required
                  >
                    <option value="">Select card...</option>
                    {data.creditCards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.creditCard.cardName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="form-group st-span-2">
                  <label className="label" htmlFor="conversion-ff-id">To Program</label>
                  <Select
                    id="conversion-ff-id"
                    className="input"
                    value={convFFId}
                    onChange={(e) => setConvFFId(e.target.value)}
                    required
                  >
                    <option value="">Select frequent flyer program...</option>
                    {data.frequentFlyers.map((ff) => (
                      <option key={ff.id} value={ff.id}>
                        {ff.programName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="conversion-points">From Points</label>
                  <NumericCalculatorInput
                    id="conversion-points"
                    min="1"
                    allowDecimal={false}
                    placeholder="10000"
                    value={convPoints}
                    onValueChange={setConvPoints}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="conversion-miles">To Miles</label>
                  <NumericCalculatorInput
                    id="conversion-miles"
                    min="1"
                    allowDecimal={false}
                    placeholder="4000"
                    value={convMiles}
                    onValueChange={setConvMiles}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label" htmlFor="conversion-desc">Description</label>
                  <Input
                    id="conversion-desc"
                    type="text"
                    className="input"
                    placeholder="Optional notes"
                    value={convDesc}
                    onChange={(e) => setConvDesc(e.target.value)}
                  />
                </div>
              </div>
              {createConversion.isError && (
                <div className="st-error">
                  {(createConversion.error as Error)?.message || "Failed to add conversion rate"}
                </div>
              )}
              <div className="st-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeConversionModal}>
                  Cancel
                </Button>
                <Button type="submit" className="btn btn-primary" disabled={createConversion.isPending}>
                  {createConversion.isPending ? "Adding..." : "Add Conversion"}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      ) : null}

      {/* Hotel Rewards Modal */}
      {isHotelModalOpen && (
        <Dialog open onClose={closeHotelModal} title="Hotel reward account" surface="custom" overlayClassName="st-modal-overlay">
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>{editingHotelId ? "Edit Hotel Rewards" : "Add Hotel Rewards"}</h3>
              <ModalCloseButton onClick={closeHotelModal} label={`Close ${editingHotelId ? "Edit Hotel Program" : "Add Hotel Program"}`} />
            </div>
            <form className="st-modal-form" onSubmit={onSubmitHotel}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Program Name</label>
                  <Input
                    className="input"
                    type="text"
                    placeholder="e.g., Marriott Bonvoy"
                    value={hotelFormProgram}
                    onChange={(e) => setHotelFormProgram(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Hotel Brand</label>
                  <Input
                    className="input"
                    type="text"
                    placeholder="e.g., Marriott"
                    value={hotelFormBrand}
                    onChange={(e) => setHotelFormBrand(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Account Number</label>
                  <Input
                    className="input"
                    type="text"
                    placeholder="Optional"
                    value={hotelFormNumber}
                    onChange={(e) => setHotelFormNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Current Points</label>
                  <NumericCalculatorInput
                    min="1"
                    allowDecimal={false}
                    placeholder="0"
                    value={hotelFormPoints}
                    onValueChange={setHotelFormPoints}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Target Points</label>
                  <NumericCalculatorInput
                    min="0"
                    allowDecimal={false}
                    placeholder="Optional"
                    value={hotelFormTarget}
                    onValueChange={setHotelFormTarget}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Cents Per Point</label>
                  <NumericCalculatorInput
                    min="0"
                    step="0.001"
                    placeholder="0.700"
                    value={hotelFormCentsPerPoint}
                    onValueChange={setHotelFormCentsPerPoint}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Notes</label>
                  <Textarea
                    className="input"
                    rows={3}
                    placeholder="Optional notes..."
                    value={hotelFormNotes}
                    onChange={(e) => setHotelFormNotes(e.target.value)}
                  />
                </div>
              </div>
              {(createHotelReward.isError || updateHotelReward.isError) && (
                <div className="st-error">
                  {((createHotelReward.error || updateHotelReward.error) as Error)?.message || "Failed to save"}
                </div>
              )}
              <div className="st-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={closeHotelModal}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createHotelReward.isPending || updateHotelReward.isPending}
                >
                  {editingHotelId
                    ? updateHotelReward.isPending
                      ? "Saving..."
                      : "Save Changes"
                    : createHotelReward.isPending
                      ? "Adding..."
                      : "Add Program"}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* Frequent Flyer Modal */}
      {isFFModalOpen && (
        <Dialog open onClose={closeFFModal} title="Frequent flyer account" surface="custom" overlayClassName="st-modal-overlay">
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>{editingFFId ? "Edit Frequent Flyer Program" : "Add Frequent Flyer Program"}</h3>
              <ModalCloseButton onClick={closeFFModal} label={`Close ${editingFFId ? "Edit Frequent Flyer Program" : "Add Frequent Flyer Program"}`} />
            </div>
            <form className="st-modal-form" onSubmit={onSubmitFF}>
              <div className="st-form-grid">
                <div className="form-group st-span-2">
                  <label className="label">Program Name</label>
                  <Input
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
                  <Input
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
                  <Input
                    className="input"
                    type="text"
                    placeholder="Optional"
                    value={ffFormNumber}
                    onChange={(e) => setFFFormNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Current Miles</label>
                  <NumericCalculatorInput
                    min="0"
                    allowDecimal={false}
                    placeholder="0"
                    value={ffFormMiles}
                    onValueChange={setFFFormMiles}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Target Miles</label>
                  <NumericCalculatorInput
                    min="0"
                    allowDecimal={false}
                    placeholder="Optional"
                    value={ffFormTarget}
                    onValueChange={setFFFormTarget}
                  />
                </div>
                <div className="form-group">
                  <label className="label">Expiry Warning (months)</label>
                  <NumericCalculatorInput
                    min="1"
                    max="24"
                    allowDecimal={false}
                    value={ffFormExpiry}
                    onValueChange={setFFFormExpiry}
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label" htmlFor="ff-mile-never-expire">Miles Never Expire</label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      minHeight: "36px",
                      fontSize: "13px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Input
                      id="ff-mile-never-expire"
                      type="checkbox"
                      checked={ffFormMileNeverExpire}
                      onChange={(e) => setFFFormMileNeverExpire(e.target.checked)}
                    />
                    Never expire
                  </label>
                </div>
                {!ffFormMileNeverExpire && (
                  <div className="form-group st-span-2">
                    <label className="label">Validity Period (years)</label>
                    <NumericCalculatorInput
                      min="1"
                      allowDecimal={false}
                      placeholder="3"
                      value={ffFormValidityPeriodYears}
                      onValueChange={setFFFormValidityPeriodYears}
                      required
                    />
                  </div>
                )}
                <div className="form-group st-span-2">
                  <label className="label">Notes</label>
                  <Textarea
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
                <Button type="button" className="btn btn-ghost" onClick={closeFFModal}>
                  Cancel
                </Button>
                <Button
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
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* Add Earn Transaction Modal */}
      {isAddEarnModalOpen && selectedHistoryFrequentFlyer && (
        <Dialog open onClose={() => setIsAddEarnModalOpen(false)} title="Add miles earned" surface="custom" overlayClassName="st-modal-overlay">
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Add Earn Transaction</h3>
              <ModalCloseButton onClick={() => setIsAddEarnModalOpen(false)} label="Close Add Earn Transaction" />
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
                  <Input
                    className="input"
                    type="date"
                    value={earnDate}
                    onChange={(e) => setEarnDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Miles Earned</label>
                  <NumericCalculatorInput
                    min="1"
                    allowDecimal={false}
                    placeholder="0"
                    value={earnMiles}
                    onValueChange={setEarnMiles}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Title (optional)</label>
                  <Input
                    className="input"
                    type="text"
                    placeholder="e.g., Flight credit, Bonus miles"
                    value={earnTitle}
                    onChange={(e) => setEarnTitle(e.target.value)}
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Expiry Date</label>
                  <Input
                    className="input"
                    type="date"
                    value={earnExpiryDate}
                    onChange={(e) => setEarnExpiryDate(e.target.value)}
                    disabled={selectedHistoryFrequentFlyer.mileNeverExpire}
                  />
                </div>
              </div>
              {createEarnTransaction.isError && (
                <div className="st-error">
                  {(createEarnTransaction.error as Error)?.message || "Failed to add transaction"}
                </div>
              )}
              <div className="st-modal-actions">
                <Button type="button" className="btn btn-ghost" onClick={() => setIsAddEarnModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createEarnTransaction.isPending}
                >
                  {createEarnTransaction.isPending ? "Saving..." : "Add Transaction"}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* Redeem Miles Modal */}
      {isRedeemModalOpen && selectedHistoryFrequentFlyer && (
        <Dialog open onClose={() => setIsRedeemModalOpen(false)} title="Redeem miles" surface="custom" overlayClassName="st-modal-overlay">
          <div className="st-modal" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-header">
              <h3>Redeem Miles</h3>
              <ModalCloseButton onClick={() => setIsRedeemModalOpen(false)} label="Close Redeem Miles" />
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
                  <Input
                    className="input"
                    type="date"
                    value={redeemDate}
                    onChange={(e) => setRedeemDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="label">Miles to Redeem</label>
                  <NumericCalculatorInput
                    min="1"
                    allowDecimal={false}
                    placeholder="0"
                    value={redeemMiles}
                    onValueChange={setRedeemMiles}
                    required
                  />
                </div>
                <div className="form-group st-span-2">
                  <label className="label">Redemption Title</label>
                  <Input
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
                <Button type="button" className="btn btn-ghost" onClick={() => setIsRedeemModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createRedeemTransaction.isPending}
                >
                  {createRedeemTransaction.isPending ? "Redeeming..." : "Redeem Miles"}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}
    </div>
  );
}
