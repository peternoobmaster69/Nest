"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { formatMoney, formatMoneyShort, normalizeCurrency } from "@/lib/currency";
import { getBrowserCookie, setBrowserCookie } from "@/lib/browser-cookies";
import { NumericCalculatorInput } from "@/components/numeric-calculator-input";
import { closeOnBackdropClick } from "@/lib/modal-dismiss";
import { AppShell } from "./app-shell";
import { getBankLogoUrl, getSingaporeBankByName } from "@/lib/singapore-banks";
import { EmptyState } from "@/components/ui-skeleton";
import {
  DashboardBankSelectorSkeleton,
  DashboardHeroSkeleton,
  DashboardNetWorthSkeleton,
  DashboardRecentTransactionsSkeleton,
} from "@/components/skeletons/DashboardSkeleton";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { ChartCursorTooltip, useChartCursorTooltip } from "@/components/chart-cursor-tooltip";
import { useToast } from "@/components/toast-provider";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

const ALL_BANKS_FILTER = "ALL";
const RECENT_TRANSACTION_LIMIT = 5;
const CASH_FLOW_ALL_ACCOUNTS = "ALL";
const CASH_FLOW_CHART_HEIGHT = 220;
const CASH_FLOW_CHART_PADDING = { top: 14, right: 14, bottom: 34, left: 42 };
const CASH_FLOW_MIN_ZOOM = 1;
const CASH_FLOW_MAX_ZOOM = 3;
const CASH_FLOW_ZOOM_STEP = 0.5;

type CashFlowAccountMonth = {
  inflowCents: number;
  outflowCents: number;
  netCents: number;
};

type CashFlowMonth = CashFlowAccountMonth & {
  key: string;
  label: string;
  accounts: Record<string, CashFlowAccountMonth>;
  budgets: Record<string, CashFlowAccountMonth>;
};

type CashFlowPoint = CashFlowAccountMonth & {
  key: string;
  label: string;
};

type DashboardSummary = {
  totalBalanceCents: number;
  bankDiscrepancies: Array<{
    id: string;
    name: string;
    currentBalanceCents: number;
    linkedBudgetTotalCents: number;
    discrepancyCents: number;
  }>;
  budgets: Array<{
    id: string;
    name: string;
    icon?: string | null;
    accountId?: string;
    availableCents: number;
    targetCents: number;
    monthlyOutgoingCents: number;
  }>;
  recentTransactions: Array<{
    id: string;
    subject: string;
    amountCents: number;
    direction: "DEBIT" | "CREDIT";
    date: string;
    budgetName?: string | null;
  }>;
  cashFlow: CashFlowMonth[];
  creditCardSummary?: {
    nextDueCards: CreditCardDueCard[];
    totalOutstandingCents: number;
    overdueCount: number;
    dueSoonCount: number;
  };
};

type CreditCardDueCard = {
  cardId: string;
  cardName: string;
  bankName?: string | null;
  statementMonth: number;
  statementYear: number;
  paymentDueDate: string;
  outstandingCents: number;
};

type CreditCardDueGroup = {
  key: string;
  bankName: string | null;
  paymentDueDate: string;
  outstandingCents: number;
  cards: CreditCardDueCard[];
};

type CreditCardDueTone = "danger" | "warning" | "success";

type AppContext = {
  workspaceId: string | null;
  defaultAccountId: string | null;
  defaultUserId: string | null;
  baseCurrency?: string | null;
  isShared?: boolean;
  isCollaborative?: boolean;
  workspaceName?: string | null;
  memberCount?: number;
  pendingInviteCount?: number;
  sidebarMoneyPages?: Record<string, boolean>;
  accounts: Array<{
    id: string;
    name: string;
    kind: string;
  }>;
};

type Budget = {
  id: string;
  accountId: string;
  name: string;
  icon?: string | null;
  targetCents: number;
  availableCents: number;
  monthlyOutgoingCents?: number;
};

type Transaction = {
  id: string;
  accountId: string;
  subject: string;
  amountCents: number;
  direction: "DEBIT" | "CREDIT";
  date: string;
  kind: string;
  budgetId?: string | null;
};

type TransactionsSummaryResponse = {
  transactions: Transaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type Receivable = {
  id: string;
  title: string;
  amountCents: number;
  date: string;
  status: string;
};

type BankAccountSummary = {
  id: string;
  name: string;
  bankName?: string | null;
  startingCents: number;
  currentBalanceCents: number;
  linkedBudgetTotalCents: number;
  discrepancyCents: number;
};

type InvestmentAccountSummary = {
  id: string;
  entries: Array<{
    id: string;
    date: string;
    investedCents: number;
    currentValueCents: number;
  }>;
};

function getAmountToneClass(valueCents: number) {
  if (valueCents < 0) return "negative";
  if (valueCents > 0) return "positive";
  return "zero";
}

async function getSummary(): Promise<DashboardSummary> {
  const res = await fetch("/api/dashboard/summary", { cache: "no-cache" });
  if (!res.ok) {
    throw new Error("Unable to load dashboard");
  }
  return res.json();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Emoji mapping for budget icons
const budgetEmojis: Record<string, string> = {
  housing: "🏠",
  home: "🏠",
  rent: "🏠",
  emergency: "🛡️",
  savings: "🛡️",
  travel: "✈️",
  vacation: "✈️",
  food: "🍔",
  dining: "🍔",
  groceries: "🥬",
  transport: "🚌",
  transportation: "🚌",
  shopping: "🛍️",
  health: "💪",
  fitness: "💪",
  medical: "💊",
  entertainment: "🎬",
  bills: "💡",
  utilities: "💡",
  education: "📚",
  investment: "📈",
  insurance: "🧾",
  phone: "📱",
  media: "🎬",
  business: "💼",
  loan: "🏦",
  card: "💳",
  child: "👶",
  pet: "🐶",
  gift: "🎁",
  hospital: "🏥",
  default: "💰",
};
const budgetIconOptions = [
  "💰", "🏠", "🛡️", "✈️", "🍔", "🥬", "🚌", "🛍️", "💪", "💊", "🎬", "💡", "📚", "📈", "🚗", "📱", "🎯",
  "🧾", "🏦", "💳", "🧮", "👶", "🎓", "🐶", "🎁", "🛠️", "💼", "🏥", "🚴", "🍜", "☕",
  // Family/Parents & Religious
  "👴", "👵", "👪", "👨‍👩‍👧‍👦", "⛪",
  // Home & Cleaning
  "🧹", "🧽", "🧼", "🪣", "🧺", "🛋️", "🛏️", "🚿", "🚽", "🪟", "🪴",
  // Nature
  "🍃", "🌿", "🌱",
  // Globe/World
  "🌍", "🗺️", "🧭",
];

function getBudgetEmoji(name: string) {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(budgetEmojis)) {
    if (lower.includes(key)) return emoji;
  }
  return budgetEmojis.default;
}

function getBudgetIcon(name: string, icon?: string | null) {
  return icon || getBudgetEmoji(name);
}

// Transaction emoji mapping
const txEmojis: Record<string, string> = {
  grocery: "🛒",
  groceries: "🛒",
  grab: "🚗",
  uber: "🚗",
  taxi: "🚗",
  transport: "🚗",
  starbucks: "☕",
  coffee: "☕",
  gym: "🏋️",
  fitness: "🏋️",
  received: "💵",
  payment: "💵",
  default: "💳",
};

function getTxEmoji(subject: string) {
  const lower = subject.toLowerCase();
  for (const [key, emoji] of Object.entries(txEmojis)) {
    if (lower.includes(key)) return emoji;
  }
  return txEmojis.default;
}

function getDaysUntil(dateStr: string) {
  const now = new Date();
  const target = new Date(dateStr);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((target.getTime() - now.getTime()) / msPerDay);
}

function getStatementLabel(month: number, year: number) {
  const statementDate = new Date(Date.UTC(year, month - 1, 1));
  const monthName = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(statementDate);
  return `${monthName} ${year}`;
}

function getPaymentDueDateLabel(dateStr: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateStr));
}

function getPaymentDueDateKey(dateStr: string) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

function getCreditCardDueGroups(cards: CreditCardDueCard[]): CreditCardDueGroup[] {
  const groups = new Map<string, CreditCardDueGroup>();

  for (const card of cards) {
    const bankName = card.bankName?.trim() || null;
    const dueDateKey = getPaymentDueDateKey(card.paymentDueDate);
    const key = `${bankName ?? "unknown"}:${dueDateKey}`;
    const group = groups.get(key);

    if (group) {
      group.outstandingCents += card.outstandingCents;
      group.cards.push(card);
      continue;
    }

    groups.set(key, {
      key,
      bankName,
      paymentDueDate: card.paymentDueDate,
      outstandingCents: card.outstandingCents,
      cards: [card],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      cards: [...group.cards].sort((a, b) => a.cardName.localeCompare(b.cardName)),
    }))
    .sort((a, b) => {
      const dueDiff = new Date(a.paymentDueDate).getTime() - new Date(b.paymentDueDate).getTime();
      if (dueDiff !== 0) return dueDiff;
      return (a.bankName ?? "").localeCompare(b.bankName ?? "");
    });
}

function getDueCountdownLabel(dateStr: string) {
  const days = getDaysUntil(dateStr);
  if (days < 0) return `Overdue by ${Math.abs(days)}d`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due in 1d";
  return `Due in ${days}d`;
}

function getDueTone(days: number): CreditCardDueTone {
  if (days < 10) return "danger";
  if (days < 20) return "warning";
  return "success";
}

function getDueToneColor(tone: CreditCardDueTone) {
  if (tone === "danger") return "var(--danger)";
  if (tone === "warning") return "var(--warning)";
  return "var(--success)";
}

function CashFlowChart({
  points,
  formatShort,
  formatFull,
}: {
  points: CashFlowPoint[];
  formatShort: (value: number) => string;
  formatFull: (value: number) => string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const tooltip = useChartCursorTooltip<CashFlowPoint>(shellRef);

  useEffect(() => {
    const chartElement = chartRef.current;
    if (!chartElement) return;

    const updateWidth = () => {
      setMeasuredWidth(Math.floor(chartElement.getBoundingClientRect().width));
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(chartElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= points.length) {
      setActiveIndex(null);
      tooltip.clear();
    }
  }, [activeIndex, points.length, tooltip]);

  const minChartWidth = 520;
  const baseChartWidth = Math.max(minChartWidth, measuredWidth);
  const chartWidth = Math.round(baseChartWidth * zoomLevel);
  const left = Math.min(CASH_FLOW_CHART_PADDING.left, Math.max(28, chartWidth * 0.16));
  const right = Math.min(CASH_FLOW_CHART_PADDING.right, Math.max(8, chartWidth * 0.04));
  const { top, bottom } = CASH_FLOW_CHART_PADDING;
  const plotWidth = Math.max(1, chartWidth - left - right);
  const plotHeight = CASH_FLOW_CHART_HEIGHT - top - bottom;
  const zeroY = top + plotHeight / 2;
  const maxAbs = Math.max(
    1,
    ...points.flatMap((point) => [point.inflowCents, point.outflowCents, Math.abs(point.netCents)]),
  );
  const xFor = (index: number) =>
    left + (plotWidth / Math.max(points.length, 1)) * (index + 0.5);
  const yFor = (value: number) => zeroY - (value / maxAbs) * (plotHeight / 2);
  const barWidth = Math.min(22, plotWidth / Math.max(points.length * 1.8, 1));
  const monthLabelStride = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 34))));
  const netPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(point.netCents).toFixed(1)}`)
    .join(" ");
  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;
  const formatSignedFull = (value: number) => (value >= 0 ? `+${formatFull(value)}` : `-${formatFull(Math.abs(value))}`);
  const zoomPercent = Math.round(zoomLevel * 100);
  const canZoomOut = zoomLevel > CASH_FLOW_MIN_ZOOM;
  const canZoomIn = zoomLevel < CASH_FLOW_MAX_ZOOM;
  const zoomOut = () => setZoomLevel((current) => Math.max(CASH_FLOW_MIN_ZOOM, current - CASH_FLOW_ZOOM_STEP));
  const zoomIn = () => setZoomLevel((current) => Math.min(CASH_FLOW_MAX_ZOOM, current + CASH_FLOW_ZOOM_STEP));
  const resetZoom = () => setZoomLevel(CASH_FLOW_MIN_ZOOM);
  const setTooltipFromFocus = (index: number) => {
    const shellElement = shellRef.current;
    const chartElement = chartRef.current;
    if (!shellElement || !chartElement) return;

    const shellRect = shellElement.getBoundingClientRect();
    const chartRect = chartElement.getBoundingClientRect();
    const x = chartRect.left - shellRect.left + xFor(index) - chartElement.scrollLeft;
    const y = chartRect.top - shellRect.top + top + plotHeight / 2;
    tooltip.showAtLocalPoint(x, y, points[index]);
  };
  const clearActivePoint = () => {
    setActiveIndex(null);
    tooltip.clear();
  };

  return (
    <div ref={shellRef} className="cash-flow-chart-shell">
      <div className="cash-flow-chart-tools" aria-label="Cash flow chart zoom controls">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-xs cash-flow-chart-tool"
          onClick={zoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out cash flow months"
          title="Zoom out"
        >
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <span className="cash-flow-zoom-value" aria-live="polite">{zoomPercent}%</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-xs cash-flow-chart-tool"
          onClick={zoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in cash flow months"
          title="Zoom in"
        >
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-xs cash-flow-chart-tool"
          onClick={resetZoom}
          disabled={!canZoomOut}
          aria-label="Reset cash flow zoom"
          title="Reset zoom"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>

      <div ref={chartRef} className="cash-flow-chart-wrap">
        <svg
          className="cash-flow-chart"
          style={{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }}
          viewBox={`0 0 ${chartWidth} ${CASH_FLOW_CHART_HEIGHT}`}
          role="group"
          aria-label="Cash flow over the last 12 months"
          onPointerLeave={clearActivePoint}
        >
          {[top, zeroY, top + plotHeight].map((y, index) => (
            <line
              key={index}
              className={index === 1 ? "cash-flow-zero-line" : "cash-flow-grid-line"}
              x1={left}
              x2={chartWidth - right}
              y1={y}
              y2={y}
            />
          ))}
          <text className="cash-flow-axis-label" x={8} y={top + 4}>
            {formatShort(maxAbs)}
          </text>
          <text className="cash-flow-axis-label" x={8} y={zeroY + 4}>
            0
          </text>
          <text className="cash-flow-axis-label" x={8} y={top + plotHeight + 4}>
            -{formatShort(maxAbs)}
          </text>

          {points.map((point, index) => {
            const centerX = xFor(index);
            const x = centerX - barWidth / 2;
            const inflowY = yFor(point.inflowCents);
            const outflowY = yFor(-point.outflowCents);
            const showMonthLabel = index % monthLabelStride === 0 || index === points.length - 1;
            const isActive = activeIndex === index;
            const hitWidth = Math.max(36, plotWidth / Math.max(points.length, 1));

            return (
              <g key={point.key} className={isActive ? "cash-flow-point-group active" : "cash-flow-point-group"}>
                <rect
                  className="cash-flow-hit-area"
                  x={Math.max(left, centerX - hitWidth / 2)}
                  y={top}
                  width={Math.min(hitWidth, chartWidth - right - Math.max(left, centerX - hitWidth / 2))}
                  height={plotHeight}
                  rx="8"
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.label}: In ${formatFull(point.inflowCents)}, out ${formatFull(point.outflowCents)}, net ${formatSignedFull(point.netCents)}`}
                  onPointerEnter={(event) => {
                    setActiveIndex(index);
                    tooltip.showAtPointer(event, point);
                  }}
                  onPointerMove={(event) => {
                    setActiveIndex(index);
                    tooltip.showAtPointer(event, point);
                  }}
                  onFocus={() => {
                    setActiveIndex(index);
                    setTooltipFromFocus(index);
                  }}
                  onBlur={clearActivePoint}
                  onClick={(event) => {
                    setActiveIndex(index);
                    tooltip.showAtPointer(event, point);
                  }}
                />
                <line
                  className="cash-flow-hover-line"
                  x1={centerX}
                  x2={centerX}
                  y1={top}
                  y2={top + plotHeight}
                />
                <rect
                  className="cash-flow-bar cash-flow-bar-in"
                  x={x}
                  y={inflowY}
                  width={barWidth}
                  height={Math.max(0, zeroY - inflowY)}
                  rx="4"
                />
                <rect
                  className="cash-flow-bar cash-flow-bar-out"
                  x={x}
                  y={zeroY}
                  width={barWidth}
                  height={Math.max(0, outflowY - zeroY)}
                  rx="4"
                />
                {showMonthLabel ? (
                  <text
                    className="cash-flow-month-label"
                    x={centerX}
                    y={CASH_FLOW_CHART_HEIGHT - 7}
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {points.length > 0 ? (
            <>
              <path className="cash-flow-net-line" d={netPath} />
              {points.map((point, index) => (
                <circle
                  key={point.key}
                  className={activeIndex === index ? "cash-flow-net-point active" : "cash-flow-net-point"}
                  cx={xFor(index)}
                  cy={yFor(point.netCents)}
                  r={activeIndex === index ? "5" : "3.5"}
                  onMouseEnter={() => setActiveIndex(index)}
                />
              ))}
            </>
          ) : null}
        </svg>
      </div>

      {activePoint && tooltip.position ? (
        <ChartCursorTooltip position={tooltip.position}>
          <strong>{activePoint.label}</strong>
          <span><i className="cash-flow-dot cash-flow-dot-in" />In {formatFull(activePoint.inflowCents)}</span>
          <span><i className="cash-flow-dot cash-flow-dot-out" />Out {formatFull(activePoint.outflowCents)}</span>
          <span><i className="cash-flow-dot cash-flow-dot-net" />Net {formatSignedFull(activePoint.netCents)}</span>
        </ChartCursorTooltip>
      ) : null}
    </div>
  );
}

const DashboardTransactionRow = memo(function DashboardTransactionRow({
  tx,
  showBudgetIcon,
  budgetIcon,
  budgetName,
  amountClassName,
  amountPrefix,
  formattedAmount,
  formattedDate,
}: {
  tx: Transaction;
  showBudgetIcon: boolean;
  budgetIcon: string | null;
  budgetName: string;
  amountClassName: string;
  amountPrefix: string;
  formattedAmount: string;
  formattedDate: string;
}) {
  return (
    <div className="tx-item">
      <div className="tx-icon">{getTxEmoji(tx.subject)}</div>
      <div className="tx-meta" style={{ flex: 1, minWidth: 0 }}>
        <div className="tx-name" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          {showBudgetIcon && budgetIcon ? <span aria-hidden="true">{budgetIcon}</span> : null}
          <span>{tx.subject}</span>
        </div>
        <div className="tx-date">
          {formattedDate} · {budgetName}
        </div>
      </div>
      <div className={`tx-amount ${amountClassName}`}>
        {amountPrefix}
        {formattedAmount}
      </div>
    </div>
  );
});

export function DashboardShell({
  userName,
  userEmail,
  userImage,
}: {
  userName: string;
  userEmail: string;
  userImage?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(userName);
  const [budgetName, setBudgetName] = useState("");
  const [budgetTarget, setBudgetTarget] = useState("");
  const [budgetAccountId, setBudgetAccountId] = useState("");
  const [createBudgetOpen, setCreateBudgetOpen] = useState(false);
  const [txSubject, setTxSubject] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txAccountId, setTxAccountId] = useState("");
  const [txBudgetId, setTxBudgetId] = useState("");
  const [txBudgetOperation, setTxBudgetOperation] = useState<"DEDUCT" | "ADD">("DEDUCT");
  const [recvTitle, setRecvTitle] = useState("");
  const [recvAmount, setRecvAmount] = useState("");
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [editingBudgetName, setEditingBudgetName] = useState("");
  const [editingBudgetIcon, setEditingBudgetIcon] = useState("");
  const [editingBudgetIsSavings, setEditingBudgetIsSavings] = useState(false);
  const [editingBudgetTarget, setEditingBudgetTarget] = useState("");
  const [editingReceivableId, setEditingReceivableId] = useState<string | null>(null);
  const [editingReceivableTitle, setEditingReceivableTitle] = useState("");
  const [editingReceivableAmount, setEditingReceivableAmount] = useState("");
  const [selectedBankFilterId, setSelectedBankFilterId] = useState<string>(ALL_BANKS_FILTER);
  const [selectedCashFlowAccountId, setSelectedCashFlowAccountId] = useState<string>(CASH_FLOW_ALL_ACCOUNTS);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [failedBankLogos, setFailedBankLogos] = useState<Record<string, boolean>>({});
  const [failedCreditCardBankLogos, setFailedCreditCardBankLogos] = useState<Record<string, boolean>>({});
  const [bankFilterHydrated, setBankFilterHydrated] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccountSummary | null>(null);
  const [editBankBalance, setEditBankBalance] = useState("");
  const bankPickerRef = useRef<HTMLDivElement | null>(null);

  const contextQuery = useQuery({
    queryKey: ["app-context"],
    queryFn: () => fetchJson<AppContext>("/api/context"),
  });

  const workspaceId = contextQuery.data?.workspaceId;
  const isContextLoading = contextQuery.isLoading && !contextQuery.data;

  const { data, isLoading, isPending } = useQuery({
    queryKey: ["dashboard-summary", workspaceId],
    queryFn: getSummary,
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });

  const isDataReady = !isPending && data !== undefined;

  const baseCurrency = normalizeCurrency(contextQuery.data?.baseCurrency);
  const formatCents = useCallback((value: number) => formatMoney(value, baseCurrency), [baseCurrency]);
  const formatCentsShort = useCallback((value: number) => formatMoneyShort(value, baseCurrency), [baseCurrency]);
  const defaultUserId = contextQuery.data?.defaultUserId;
  const dashboardBankStorageKey = workspaceId ? `nest:selectedBank:${workspaceId}` : null;
  const sidebarMoneyPages = contextQuery.data?.sidebarMoneyPages;
  const showCreditCardDashboardSection =
    sidebarMoneyPages?.creditCards !== false || sidebarMoneyPages?.creditTransactions !== false;
  const creditCardDueGroups = useMemo(
    () => getCreditCardDueGroups(data?.creditCardSummary?.nextDueCards ?? []),
    [data?.creditCardSummary?.nextDueCards],
  );
  const budgetsQuery = useQuery({
    queryKey: ["budgets", workspaceId],
    queryFn: () => fetchJson<Budget[]>(`/api/budgets?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const bankAccountsQuery = useQuery({
    queryKey: ["bank-accounts", workspaceId],
    queryFn: () => fetchJson<BankAccountSummary[]>(`/api/accounts?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const bankAccountOptions = useMemo(() => bankAccountsQuery.data ?? [], [bankAccountsQuery.data]);
  const hasMultipleBankAccounts = bankAccountOptions.length > 1;
  const effectiveSelectedBankFilterId =
    bankAccountOptions.length === 1 ? bankAccountOptions[0].id : selectedBankFilterId;

  const transactionsQuery = useQuery({
    queryKey: ["transactions", workspaceId, effectiveSelectedBankFilterId],
    queryFn: () => {
      const params = new URLSearchParams({
        workspaceId: workspaceId ?? "",
        paginated: "1",
        limit: String(RECENT_TRANSACTION_LIMIT),
      });
      if (effectiveSelectedBankFilterId !== "ALL") {
        params.set("accountId", effectiveSelectedBankFilterId);
      }
      return fetchJson<TransactionsSummaryResponse>(`/api/transactions?${params.toString()}`);
    },
    enabled: Boolean(workspaceId),
  });

  const receivablesQuery = useQuery({
    queryKey: ["receivables", workspaceId],
    queryFn: () => fetchJson<Receivable[]>(`/api/receivables?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const investmentsQuery = useQuery({
    queryKey: ["investments", workspaceId],
    queryFn: () => fetchJson<InvestmentAccountSummary[]>(`/api/investments?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  const firstBankAccountId = bankAccountOptions[0]?.id;

  const updateBankBalance = useMutation({
    mutationFn: ({ id, startingCents }: { id: string; startingCents: number }) =>
      fetchJson(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startingCents }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary", workspaceId] });
      setEditingBankAccount(null);
      setEditBankBalance("");
      pushToast("success", "Bank balance updated.");
    },
    onError: (error) => {
      pushToast("error", error instanceof Error ? error.message : "Failed to update bank balance.");
    },
  });

  const refreshAll = useMemo(
    () => () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["budgets", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["receivables", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["bank-accounts", workspaceId] }),
      ]),
    [queryClient, workspaceId]
  );

  const budgetsKey = ["budgets", workspaceId] as const;
  const transactionsKey = ["transactions", workspaceId] as const;
  const receivablesKey = ["receivables", workspaceId] as const;

  const pushToast = (kind: "success" | "error" | "info", message: string) => toast.notify(message, kind);

  const openEditBankBalance = (bank: BankAccountSummary) => {
    setEditingBankAccount(bank);
    setEditBankBalance((bank.currentBalanceCents / 100).toFixed(2));
  };

  const closeEditBankBalance = () => {
    setEditingBankAccount(null);
    setEditBankBalance("");
  };

  const onSubmitBankBalance = (event: FormEvent) => {
    event.preventDefault();
    if (!editingBankAccount || !editBankBalance) return;
    updateBankBalance.mutate({
      id: editingBankAccount.id,
      startingCents: Math.round(Number(editBankBalance) * 100),
    });
  };

  const createBudget = useMutation({
    mutationFn: (payload: { name: string; targetCents: number; accountId: string; icon?: string }) =>
      fetchJson("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          name: payload.name,
          icon: payload.icon,
          targetCents: payload.targetCents,
        }),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: budgetsKey });
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      const optimistic: Budget = {
        id: `temp-budget-${Date.now()}`,
        accountId: payload.accountId,
        name: payload.name,
        icon: payload.icon,
        targetCents: payload.targetCents,
        availableCents: 0,
      };
      queryClient.setQueryData<Budget[]>(budgetsKey, (old) => [optimistic, ...(old ?? [])]);
      return { previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Budget creation failed.");
    },
    onSuccess: () => {
      pushToast("success", "Budget created.");
      setCreateBudgetOpen(false);
      setBudgetName("");
      setBudgetTarget("");
      setBudgetAccountId("");
    },
    onSettled: refreshAll,
  });

  const createTransaction = useMutation({
    mutationFn: (payload: {
      subject: string;
      amountCents: number;
      accountId: string;
      operation: "DEDUCT" | "ADD";
      budgetId?: string;
      budgetOperation?: "DEDUCT" | "ADD";
    }) =>
      fetchJson("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: payload.accountId,
          subject: payload.subject,
          amountCents: payload.amountCents,
          direction: payload.operation === "ADD" ? "CREDIT" : "DEBIT",
          kind: payload.operation === "ADD" ? "ADJUSTMENT" : "EXPENSE",
          date: new Date().toISOString(),
          budgetId: payload.budgetId,
          budgetOperation: payload.budgetOperation,
        }),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: transactionsKey });
      const previousTransactions = queryClient.getQueryData<Transaction[]>(transactionsKey);
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      const optimistic: Transaction = {
        id: `temp-tx-${Date.now()}`,
        accountId: payload.accountId,
        subject: payload.subject,
        amountCents: payload.amountCents,
        direction: "DEBIT",
        date: new Date().toISOString(),
        kind: "EXPENSE",
      };
      queryClient.setQueryData<Transaction[]>(transactionsKey, (old) => [optimistic, ...(old ?? [])]);
      if (payload.budgetId && payload.budgetOperation) {
        const delta = payload.budgetOperation === "DEDUCT" ? -payload.amountCents : payload.amountCents;
        queryClient.setQueryData<Budget[]>(budgetsKey, (old) =>
          (old ?? []).map((b) => (b.id === payload.budgetId ? { ...b, availableCents: b.availableCents + delta } : b)),
        );
      }
      return { previousTransactions, previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(transactionsKey, context.previousTransactions);
      }
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Transaction creation failed.");
    },
    onSuccess: () => pushToast("success", "Transaction added."),
    onSettled: refreshAll,
  });

  const createReceivable = useMutation({
    mutationFn: (payload: { title: string; amountCents: number }) =>
      fetchJson("/api/receivables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          accountId: firstBankAccountId,
          fromUserId: defaultUserId || undefined,
          title: payload.title,
          amountCents: payload.amountCents,
          date: new Date().toISOString(),
          status: "OPEN",
        }),
      }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      const optimistic: Receivable = {
        id: `temp-recv-${Date.now()}`,
        title: payload.title,
        amountCents: payload.amountCents,
        date: new Date().toISOString(),
        status: "OPEN",
      };
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) => [optimistic, ...(old ?? [])]);
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable creation failed.");
    },
    onSuccess: () => pushToast("success", "Receivable added."),
    onSettled: refreshAll,
  });

  const updateBudget = useMutation({
    mutationFn: ({ id, name, icon, targetCents }: { id: string; name: string; icon?: string; targetCents: number }) =>
      fetchJson(`/api/budgets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, targetCents }),
      }),
    onMutate: async ({ id, name, icon, targetCents }) => {
      await queryClient.cancelQueries({ queryKey: budgetsKey });
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      queryClient.setQueryData<Budget[]>(budgetsKey, (old) =>
        (old ?? []).map((b) => (b.id === id ? { ...b, name, icon: icon ?? b.icon, targetCents } : b))
      );
      return { previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Budget edit failed.");
    },
    onSuccess: () => pushToast("success", "Budget updated."),
    onSettled: refreshAll,
  });

  const deleteBudget = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/budgets/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: budgetsKey });
      const previousBudgets = queryClient.getQueryData<Budget[]>(budgetsKey);
      queryClient.setQueryData<Budget[]>(budgetsKey, (old) => (old ?? []).filter((b) => b.id !== id));
      return { previousBudgets };
    },
    onError: (_, __, context) => {
      if (context?.previousBudgets) {
        queryClient.setQueryData(budgetsKey, context.previousBudgets);
      }
      pushToast("error", "Budget delete failed.");
    },
    onSuccess: () => pushToast("success", "Budget deleted."),
    onSettled: refreshAll,
  });

  const markReceivablePaid = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/receivables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID" }),
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, status: "PAID" } : r))
      );
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable update failed.");
    },
    onSuccess: () => pushToast("success", "Receivable marked paid."),
    onSettled: refreshAll,
  });

  const updateReceivable = useMutation({
    mutationFn: ({ id, title, amountCents }: { id: string; title: string; amountCents: number }) =>
      fetchJson(`/api/receivables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, amountCents }),
      }),
    onMutate: async ({ id, title, amountCents }) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) =>
        (old ?? []).map((r) => (r.id === id ? { ...r, title, amountCents } : r))
      );
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable edit failed.");
    },
    onSuccess: () => pushToast("success", "Receivable updated."),
    onSettled: refreshAll,
  });

  const deleteReceivable = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/receivables/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: receivablesKey });
      const previousReceivables = queryClient.getQueryData<Receivable[]>(receivablesKey);
      queryClient.setQueryData<Receivable[]>(receivablesKey, (old) => (old ?? []).filter((r) => r.id !== id));
      return { previousReceivables };
    },
    onError: (_, __, context) => {
      if (context?.previousReceivables) {
        queryClient.setQueryData(receivablesKey, context.previousReceivables);
      }
      pushToast("error", "Receivable delete failed.");
    },
    onSuccess: () => pushToast("success", "Receivable deleted."),
    onSettled: refreshAll,
  });

  const onCreateBudget = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !budgetAccountId || !defaultUserId || !budgetName.trim()) return;
    const parsedTarget = budgetTarget.trim() ? Number(budgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    createBudget.mutate({ name: budgetName.trim(), targetCents: Math.round(parsedTarget * 100), accountId: budgetAccountId });
  };

  const onCreateTx = (event: FormEvent) => {
    event.preventDefault();
    const selectedBudget = budgetsQuery.data?.find((b) => b.id === txBudgetId);
    const accountId = selectedBudget?.accountId || txAccountId;
    if (!workspaceId || !accountId || !txSubject || !txAmount) return;
    createTransaction.mutate({
      subject: txSubject,
      amountCents: Math.round(Number(txAmount) * 100),
      accountId,
      operation: txBudgetOperation,
      budgetId: txBudgetId || undefined,
      budgetOperation: txBudgetId ? txBudgetOperation : undefined,
    });
    setTxSubject("");
    setTxAmount("");
    setTxAccountId("");
  };

  const onCreateReceivable = (event: FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !recvTitle || !recvAmount) return;
    createReceivable.mutate({ title: recvTitle, amountCents: Math.round(Number(recvAmount) * 100) });
    setRecvTitle("");
    setRecvAmount("");
  };

  const startBudgetEdit = (budget: Budget) => {
    const resolvedIcon = getBudgetIcon(budget.name, budget.icon);
    setEditingBudgetId(budget.id);
    setEditingBudgetName(budget.name);
    setEditingBudgetIcon(resolvedIcon);
    setEditingBudgetIsSavings(resolvedIcon === "🛡️");
    setEditingBudgetTarget(String((budget.targetCents / 100).toFixed(2)));
  };

  const saveBudgetEdit = () => {
    if (!editingBudgetId || !editingBudgetName.trim()) return;
    const parsedTarget = editingBudgetTarget.trim() ? Number(editingBudgetTarget) : 0;
    if (Number.isNaN(parsedTarget) || parsedTarget < 0) return;
    updateBudget.mutate({
      id: editingBudgetId,
      name: editingBudgetName.trim(),
      icon: editingBudgetIsSavings ? "🛡️" : editingBudgetIcon || undefined,
      targetCents: Math.round(parsedTarget * 100),
    });
    setEditingBudgetId(null);
    setEditingBudgetName("");
    setEditingBudgetIcon("");
    setEditingBudgetIsSavings(false);
    setEditingBudgetTarget("");
  };

  const startReceivableEdit = (recv: Receivable) => {
    setEditingReceivableId(recv.id);
    setEditingReceivableTitle(recv.title);
    setEditingReceivableAmount(String((recv.amountCents / 100).toFixed(2)));
  };

  const saveReceivableEdit = () => {
    if (!editingReceivableId || !editingReceivableTitle || !editingReceivableAmount) return;
    updateReceivable.mutate({
      id: editingReceivableId,
      title: editingReceivableTitle,
      amountCents: Math.round(Number(editingReceivableAmount) * 100),
    });
    setEditingReceivableId(null);
    setEditingReceivableTitle("");
    setEditingReceivableAmount("");
  };

  const confirmDeleteBudget = async (budgetId: string) => {
    if (!(await confirmDestructiveAction("Delete this sub-account?"))) return;
    deleteBudget.mutate(budgetId);
    setEditingBudgetId(null);
    setEditingBudgetIcon("");
  };

  const summary = data ?? {
    totalBalanceCents: 0,
    bankDiscrepancies: [],
    budgets: [],
    recentTransactions: [],
    cashFlow: [],
  };
  const filteredBudgets = useMemo(
    () =>
      (budgetsQuery.data ?? []).filter((b) => effectiveSelectedBankFilterId === "ALL" || b.accountId === effectiveSelectedBankFilterId),
    [budgetsQuery.data, effectiveSelectedBankFilterId],
  );
  const filteredTransactions = useMemo(
    () => transactionsQuery.data?.transactions ?? [],
    [transactionsQuery.data],
  );
  const goToTransactionsForSubAccount = useCallback((budgetId: string, accountId: string) => {
    const params = new URLSearchParams({
      budgetId,
      accountId,
    });
    router.push(`/transactions?${params.toString()}`);
  }, [router]);
  const goToCreditCardStatement = useCallback((card: CreditCardDueCard) => {
    const params = new URLSearchParams({
      cardId: card.cardId,
      month: String(card.statementMonth),
      year: String(card.statementYear),
    });
    router.push(`/credit-transactions?${params.toString()}`);
  }, [router]);
  const budgetNameById = useMemo(
    () => new Map((budgetsQuery.data ?? []).map((b) => [b.id, b.name])),
    [budgetsQuery.data],
  );
  const budgetById = useMemo(
    () => new Map((budgetsQuery.data ?? []).map((b) => [b.id, b])),
    [budgetsQuery.data],
  );
  const filteredBankDiscrepancies = useMemo(
    () =>
      summary.bankDiscrepancies.filter((d) => effectiveSelectedBankFilterId === "ALL" || d.id === effectiveSelectedBankFilterId),
    [summary.bankDiscrepancies, effectiveSelectedBankFilterId],
  );
  const filteredBankBalance =
    effectiveSelectedBankFilterId === "ALL"
      ? summary.totalBalanceCents
      : bankAccountOptions.find((b) => b.id === effectiveSelectedBankFilterId)?.currentBalanceCents ?? 0;

  const totalBudgeted = useMemo(
    () => filteredBudgets.reduce((sum, b) => sum + b.availableCents, 0),
    [filteredBudgets],
  );
  const freeAmount = useMemo(
    () => Math.max(0, filteredBankBalance - totalBudgeted),
    [filteredBankBalance, totalBudgeted],
  );
  const recentTransactionRows = useMemo(
    () =>
      filteredTransactions.slice(0, RECENT_TRANSACTION_LIMIT).map((tx) => {
        const budget = tx.budgetId ? budgetById.get(tx.budgetId) : undefined;
        return {
          tx,
          showBudgetIcon: effectiveSelectedBankFilterId === "ALL" && Boolean(budget),
          budgetIcon: budget ? getBudgetIcon(budget.name, budget.icon) : null,
          budgetName: (tx.budgetId && budgetNameById.get(tx.budgetId)) || "Unassigned",
          amountClassName: getAmountToneClass(tx.direction === "DEBIT" ? -tx.amountCents : tx.amountCents),
          amountPrefix: tx.direction === "DEBIT" ? "−" : "+",
          formattedAmount: formatCents(tx.amountCents),
          formattedDate: new Date(tx.date).toLocaleDateString(),
        };
      }),
    [budgetById, budgetNameById, effectiveSelectedBankFilterId, filteredTransactions, formatCents],
  );
  const cashFlowAccountOptions = useMemo(
    () => [
      { id: CASH_FLOW_ALL_ACCOUNTS, name: "All sub-accounts" },
      ...filteredBudgets.map((budget) => ({ id: budget.id, name: budget.name })),
    ],
    [filteredBudgets],
  );
  useEffect(() => {
    if (
      selectedCashFlowAccountId !== CASH_FLOW_ALL_ACCOUNTS &&
      !cashFlowAccountOptions.some((account) => account.id === selectedCashFlowAccountId)
    ) {
      setSelectedCashFlowAccountId(CASH_FLOW_ALL_ACCOUNTS);
    }
  }, [cashFlowAccountOptions, selectedCashFlowAccountId]);
  const selectedCashFlowAccountName =
    cashFlowAccountOptions.find((account) => account.id === selectedCashFlowAccountId)?.name ?? "All sub-accounts";
  const cashFlowScopeName =
    effectiveSelectedBankFilterId === ALL_BANKS_FILTER
      ? "all accounts"
      : bankAccountOptions.find((account) => account.id === effectiveSelectedBankFilterId)?.name ?? "selected account";
  const cashFlowPoints = useMemo<CashFlowPoint[]>(
    () =>
      (summary.cashFlow ?? []).map((month) => {
        if (selectedCashFlowAccountId === CASH_FLOW_ALL_ACCOUNTS) {
          const accountMonth = effectiveSelectedBankFilterId === ALL_BANKS_FILTER
            ? month
            : month.accounts?.[effectiveSelectedBankFilterId] ?? {
                inflowCents: 0,
                outflowCents: 0,
                netCents: 0,
              };
          return {
            key: month.key,
            label: month.label,
            inflowCents: accountMonth.inflowCents,
            outflowCents: accountMonth.outflowCents,
            netCents: accountMonth.netCents,
          };
        }
        const budgetMonth = month.budgets?.[selectedCashFlowAccountId] ?? {
          inflowCents: 0,
          outflowCents: 0,
          netCents: 0,
        };
        return {
          key: month.key,
          label: month.label,
          inflowCents: budgetMonth.inflowCents,
          outflowCents: budgetMonth.outflowCents,
          netCents: budgetMonth.netCents,
        };
      }),
    [effectiveSelectedBankFilterId, selectedCashFlowAccountId, summary.cashFlow],
  );
  const hasCashFlowData = cashFlowPoints.some((point) => point.inflowCents > 0 || point.outflowCents > 0);

  const pendingReceivables = receivablesQuery.data?.filter((r) => r.status === "OPEN") || [];
  const investmentTotals = useMemo(() => {
    let invested = 0;
    let current = 0;
    for (const account of investmentsQuery.data ?? []) {
      const latest = [...(account.entries ?? [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .at(-1);
      invested += latest?.investedCents ?? 0;
      current += latest?.currentValueCents ?? 0;
    }
    return { invested, current };
  }, [investmentsQuery.data]);
  const investmentGain = investmentTotals.current - investmentTotals.invested;
  const investmentGainPct = investmentTotals.invested > 0
    ? (investmentGain / investmentTotals.invested) * 100
    : 0;
  const totalSavings = filteredBudgets
    .filter((budget) => getBudgetIcon(budget.name, budget.icon) === "🛡️")
    .reduce((sum, budget) => sum + budget.availableCents, 0);
  const totalInvestmentsAndSavings = investmentTotals.current + totalSavings;
  const selectedBank =
    effectiveSelectedBankFilterId === "ALL"
      ? null
      : bankAccountOptions.find((bank) => bank.id === effectiveSelectedBankFilterId) ?? null;

  useEffect(() => {
    if (!dashboardBankStorageKey) return;
    const saved = getBrowserCookie(dashboardBankStorageKey);
    if (saved && saved !== ALL_BANKS_FILTER) {
      setSelectedBankFilterId(saved);
    } else {
      setSelectedBankFilterId(ALL_BANKS_FILTER);
    }
    setBankFilterHydrated(true);
  }, [dashboardBankStorageKey]);

  useEffect(() => {
    if (!dashboardBankStorageKey || !bankFilterHydrated) return;
    setBrowserCookie(dashboardBankStorageKey, selectedBankFilterId || ALL_BANKS_FILTER);
  }, [dashboardBankStorageKey, selectedBankFilterId, bankFilterHydrated]);

  useEffect(() => {
    if (!bankAccountOptions.length) return;
    if (bankAccountOptions.length === 1) {
      const onlyBankId = bankAccountOptions[0].id;
      if (selectedBankFilterId !== onlyBankId) setSelectedBankFilterId(onlyBankId);
      return;
    }
    if (selectedBankFilterId !== "ALL" && !bankAccountOptions.some((b) => b.id === selectedBankFilterId)) {
      setSelectedBankFilterId("ALL");
    }
  }, [bankAccountOptions, selectedBankFilterId]);

  useEffect(() => {
    if (!isBankPickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!bankPickerRef.current?.contains(event.target as Node)) {
        setIsBankPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isBankPickerOpen]);

  return (
    <>
      <AppShell
        title="Dashboard"
        currentPath="/"
        userName={displayName}
        userEmail={userEmail}
        userImage={userImage}
        onDisplayNameUpdated={setDisplayName}
        badgeCounts={{
          budgets: summary.budgets.length,
          receivables: pendingReceivables.length,
        }}
        contextData={contextQuery.data}
        contextLoading={isContextLoading}
        topbarTitle={<div className="tb-title">{getGreeting()}, {displayName.split(" ")[0]} 👋</div>}
      >
          {bankAccountsQuery.isLoading || !isDataReady ? (
            <DashboardBankSelectorSkeleton />
          ) : (
            <div className="bank-selector-row" style={{ marginBottom: "10px" }}>
                <div className="bank-selector-summary">
                  <div className="bank-selector-main">
                    {selectedBank ? (
                      (() => {
                        const bankMeta = getSingaporeBankByName(selectedBank.bankName || selectedBank.name);
                        const logo = getBankLogoUrl(bankMeta);
                        return logo && !failedBankLogos[selectedBank.id] ? (
                          <Image
                            src={logo}
                            alt={bankMeta?.name || "Bank"}
                            width={44}
                            height={24}
                            sizes="44px"
                            className={`bank-logo-img ${bankMeta?.code === "DBS" ? "bank-logo-img-dbs" : ""}`}
                            loading="lazy"
                            onError={() => setFailedBankLogos((prev) => ({ ...prev, [selectedBank.id]: true }))}
                          />
                        ) : bankMeta ? (
                          <span className="bank-icon" style={{ backgroundColor: bankMeta.color }}>
                            {bankMeta.short}
                          </span>
                        ) : (
                          <span className="bank-icon bank-icon-default">BNK</span>
                        );
                      })()
                    ) : (
                      <span className="bank-icon bank-icon-default">ALL</span>
                    )}
                    <div className={`bank-selector-amount ${getAmountToneClass(filteredBankBalance)}`}>
                      {formatCents(filteredBankBalance)}
                    </div>
                  </div>
                  <div className="bank-selector-actions" ref={bankPickerRef}>
                    {hasMultipleBankAccounts ? (
                      <button
                        type="button"
                        className="bm-edit-btn"
                        onClick={() => setIsBankPickerOpen((open) => !open)}
                        aria-label="Choose bank"
                        title="Choose bank"
                      >
                        ▾
                      </button>
                    ) : null}
                    {selectedBank ? (
                      <button
                        type="button"
                        className="bm-edit-btn"
                        onClick={() => openEditBankBalance(selectedBank)}
                        aria-label={`Edit ${selectedBank.name} balance`}
                        title="Edit balance"
                      >
                        ✎
                      </button>
                    ) : null}
                    {isBankPickerOpen && hasMultipleBankAccounts ? (
                      <div className="bank-selector-menu" role="menu" aria-label="Bank options">
                        <button
                          type="button"
                          className={`bank-selector-option${selectedBankFilterId === "ALL" ? " is-active" : ""}`}
                          onClick={() => {
                            setSelectedBankFilterId("ALL");
                            setIsBankPickerOpen(false);
                          }}
                        >
                          All banks
                        </button>
                        {bankAccountOptions.map((bank) => (
                          <button
                            key={bank.id}
                            type="button"
                            className={`bank-selector-option${selectedBankFilterId === bank.id ? " is-active" : ""}`}
                            onClick={() => {
                              setSelectedBankFilterId(bank.id);
                              setIsBankPickerOpen(false);
                            }}
                          >
                            {bank.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
            </div>
          )}

          {!isDataReady ? (
            <DashboardNetWorthSkeleton />
          ) : (
            <div style={{ marginBottom: "10px" }}>
              <div className="bank-selector-row dashboard-mini-card">
                <div className="dashboard-mini-card-stack dashboard-mini-card-strip">
                  <div className="dashboard-mini-card-primary">
                    <div className="dashboard-mini-card-label">Net Worth</div>
                    <div className={`dashboard-mini-card-total ${totalInvestmentsAndSavings > 0 ? "positive" : ""}`}>
                      {formatCents(totalInvestmentsAndSavings)}
                    </div>
                    <div className="dashboard-mini-card-breakdown">
                      <Link
                        href="/investments"
                        className="dashboard-breakdown-item"
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <span className="dashboard-breakdown-icon" style={{ color: "var(--brand-400)" }}>📈</span>
                        <span className="dashboard-breakdown-value">{formatCents(investmentTotals.current)}</span>
                      </Link>
                      <span className="dashboard-breakdown-sep">+</span>
                      <div className="dashboard-breakdown-item">
                        <span className="dashboard-breakdown-icon" style={{ color: "var(--success)" }}>🐷</span>
                        <span className="dashboard-breakdown-value">{formatCents(totalSavings)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="dashboard-mini-card-metric dashboard-mini-card-gain">
                    <div className="dashboard-mini-card-label">
                      <span className="gain-label-desktop">Investment Gain</span>
                      <span className="gain-label-mobile">Gain</span>
                    </div>
                    <div className={`dashboard-mini-card-value ${getAmountToneClass(investmentGain)}`}>
                      {formatCents(investmentGain)}
                    </div>
                    <div className={`gain-percent ${getAmountToneClass(investmentGain)}`}>
                      {investmentGain >= 0 ? "" : "-"}
                      {Math.abs(investmentGainPct).toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Hero Card */}
          {!isDataReady ? (
            <DashboardHeroSkeleton />
          ) : (
            <div className="hero-card">
              <div className="hero-content">
                  <div className="hero-main">
                    <div className="hero-label">Total in record</div>
                    <div className={`hero-amount ${getAmountToneClass(totalBudgeted)}`}>{formatCents(totalBudgeted)}</div>
                    <div className="hero-sub">Across {filteredBudgets.length} sub-accounts</div>
                  </div>
                  {freeAmount > 0 && (
                    <div className="hero-side">
                      <div className="hero-side-label">Unallocated: <span className={getAmountToneClass(freeAmount)}>{formatCents(freeAmount)}</span></div>
                      <div className={`hero-side-amount ${getAmountToneClass(filteredBankBalance)}`}>
                        Available in bank
                      </div>
                      <div className={`hero-side-free ${getAmountToneClass(freeAmount)}`}>
                        {formatCents(filteredBankBalance)}
                      </div>
                    </div>
                  )}
              </div>

              {filteredBudgets.length > 0 && (
                <div className="hero-chips">
                  {filteredBudgets.slice(0, 5).map((budget) => (
                    <div
                      key={budget.id}
                      className="hero-chip"
                      onClick={() => router.push(`/transactions?budgetId=${budget.id}&accountId=${budget.accountId}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/transactions?budgetId=${budget.id}&accountId=${budget.accountId}`);
                        }
                      }}
                    >
                      <span className={`hero-chip-dot ${budget.availableCents < 0 ? "is-negative" : ""}`} aria-hidden="true" />
                      <div className="hero-chip-label">{budget.name}</div>
                      <div className="hero-chip-value">{formatCentsShort(budget.availableCents)}</div>
                    </div>
                  ))}
                  {filteredBudgets.length > 5 && (
                    <div
                      className="hero-chip"
                      onClick={() => router.push("/transactions")}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push("/transactions");
                        }
                      }}
                    >
                      <div className="hero-chip-label">+{filteredBudgets.length - 5} more</div>
                      <div className="hero-chip-value">
                        {formatCentsShort(filteredBudgets.slice(5).reduce((sum, b) => sum + b.availableCents, 0))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {filteredBankDiscrepancies.length > 0 && (
            <div
              className="alert alert-warn"
              style={{
                marginBottom: "14px",
                borderColor: "var(--danger)",
                background: "var(--danger-bg)",
                color: "var(--danger)",
                padding: "12px 14px",
              }}
            >
              <span className="alert-icon" style={{ color: "var(--danger)", fontSize: "16px" }}>⚠️</span>
              <div className="alert-body">
                <div className="alert-title" style={{ color: "var(--danger)", fontWeight: 700 }}>
                  Bank balance to accounts discrepancy detected
                </div>
                {filteredBankDiscrepancies.map((d) => (
                  <div key={d.id} style={{ fontSize: "12px", color: "var(--danger)" }}>
                    {d.name}: bank {formatCents(d.currentBalanceCents)} vs accounts {formatCents(d.linkedBudgetTotalCents)}
                    {" "}({d.discrepancyCents > 0 ? "+" : ""}
                    {formatCents(d.discrepancyCents)} mismatch)
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Two Column Layout */}
          <div
            className={`dashboard-home-grid${showCreditCardDashboardSection ? " grid-2" : " dashboard-home-grid-no-credit"}`}
            style={{ marginTop: "14px" }}
          >
            {/* Credit Card Summary */}
            {showCreditCardDashboardSection ? (
              <div className="card cc-home-panel">
                <div className="cc-home-header">
                  <div className="cc-home-title">
                    <span aria-hidden="true">💳</span>
                    <span>Credit Cards</span>
                  </div>
                  <button className="btn btn-ghost btn-xs" onClick={() => router.push("/credit-transactions")}>
                    View all →
                  </button>
                </div>

                {data?.creditCardSummary && creditCardDueGroups.length > 0 ? (
                  <>
                    <div className="cc-home-list">
                      {creditCardDueGroups.map((group) => {
                        const dueCountdown = getDueCountdownLabel(group.paymentDueDate);
                        const dueDate = getPaymentDueDateLabel(group.paymentDueDate);
                        const dueDays = getDaysUntil(group.paymentDueDate);
                        const dueTone = getDueTone(dueDays);
                        const dueColor = getDueToneColor(dueTone);
                        const showDueBadge = dueDays <= 20;
                        const bankMeta = getSingaporeBankByName(group.bankName);
                        const logo = getBankLogoUrl(bankMeta);
                        const logoKey = group.bankName ?? group.key;
                        return (
                          <div key={group.key} className={`cc-home-group cc-home-group-${dueTone}`}>
                            <div className="cc-home-group-head">
                              <div className="cc-home-bank">
                                {logo && !failedCreditCardBankLogos[logoKey] ? (
                                  <Image
                                    src={logo}
                                    alt={bankMeta?.name || "Bank"}
                                    width={34}
                                    height={34}
                                    sizes="34px"
                                    className="cc-home-bank-logo"
                                    loading="lazy"
                                    onError={() => setFailedCreditCardBankLogos((prev) => ({ ...prev, [logoKey]: true }))}
                                  />
                                ) : bankMeta ? (
                                  <span className="cc-home-bank-fallback" style={{ backgroundColor: bankMeta.color }}>
                                    {bankMeta.short}
                                  </span>
                                ) : (
                                  <span className="cc-home-bank-fallback cc-home-bank-fallback-default">CC</span>
                                )}
                                <div className="cc-home-bank-copy">
                                  <div className="cc-home-bank-name">{bankMeta?.name || group.bankName || "Credit Cards"}</div>
                                  <div className="cc-home-bank-meta">
                                    {group.cards.length} {group.cards.length === 1 ? "card" : "cards"}
                                  </div>
                                  <div className="cc-home-bank-due">Due {dueDate}</div>
                                </div>
                              </div>
                              <div className="cc-home-group-total">
                                <div className="cc-home-total-amount">{formatCents(group.outstandingCents)}</div>
                                {showDueBadge ? (
                                  <div
                                    className={`cc-home-due-badge cc-home-due-badge-${dueTone}`}
                                    title={`Payment due ${dueDate}`}
                                    style={{ color: dueColor }}
                                  >
                                    {dueCountdown}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="cc-home-card-list">
                              {group.cards.map((card) => (
                                <div
                                  key={`${card.cardId}:${card.statementYear}:${card.statementMonth}`}
                                  className="cc-home-card-row"
                                >
                                  <div className="cc-home-card-copy">
                                    <div className="cc-home-card-name">{card.cardName}</div>
                                    <div className="cc-home-card-statement">{getStatementLabel(card.statementMonth, card.statementYear)}</div>
                                  </div>
                                  <div className="cc-home-card-actions">
                                    <div className="cc-home-card-amount">{formatCents(card.outstandingCents)}</div>
                                    <button
                                      type="button"
                                      className="cc-home-view-statement"
                                      title={`View ${card.cardName} ${getStatementLabel(card.statementMonth, card.statementYear)} transactions`}
                                      aria-label={`View ${card.cardName} ${getStatementLabel(card.statementMonth, card.statementYear)} transactions`}
                                      onClick={() => goToCreditCardStatement(card)}
                                    >
                                      <svg className="eye-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "14px", height: "14px" }}>
                                        <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                                        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon="💳"
                    title="No credit card transactions"
                    description="Add credit card transactions to track your spending and accounting."
                  />
                )}
              </div>
            ) : null}

            <div className="dashboard-home-side-stack">
              <div className="card cash-flow-card">
                <div className="cash-flow-head">
                  <div>
                    <div className="cash-flow-title">📈 Cash flow</div>
                    <div className="cash-flow-subtitle">{selectedCashFlowAccountName} in {cashFlowScopeName} - last 12 months</div>
                  </div>
                  <div className="cash-flow-legend" aria-label="Cash flow legend">
                    <span><span className="cash-flow-dot cash-flow-dot-in" />In</span>
                    <span><span className="cash-flow-dot cash-flow-dot-out" />Out</span>
                    <span><span className="cash-flow-dot cash-flow-dot-net" />Net</span>
                  </div>
                </div>

                <div className="cash-flow-pills" aria-label="Cash flow account filter">
                  {cashFlowAccountOptions.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={`cash-flow-pill${selectedCashFlowAccountId === account.id ? " active" : ""}`}
                      onClick={() => setSelectedCashFlowAccountId(account.id)}
                    >
                      {account.name}
                    </button>
                  ))}
                </div>

                {isLoading || !isDataReady ? (
                  <div className="cash-flow-chart-skeleton skeleton" />
                ) : hasCashFlowData ? (
                  <CashFlowChart points={cashFlowPoints} formatShort={formatCentsShort} formatFull={formatCents} />
                ) : (
                  <EmptyState
                    icon="$"
                    title="No cash flow yet"
                    description="Add income and expense transactions to see your monthly flow."
                  />
                )}
              </div>

              {/* Recent Transactions */}
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>🆕 Recent transactions</div>
                  <button className="btn btn-ghost btn-xs" onClick={() => router.push("/transactions")}>
                    View all →
                  </button>
                </div>

                <div>
                  {recentTransactionRows.map((row) => (
                    <DashboardTransactionRow key={row.tx.id} {...row} />
                  ))}
                  {transactionsQuery.isLoading && <DashboardRecentTransactionsSkeleton />}
                  {!transactionsQuery.isLoading && !filteredTransactions.length && (
                    <EmptyState
                      icon="📑"
                      title="No transactions yet"
                      description="Add your first transaction to start tracking your spending."
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

        {createBudgetOpen && (
          <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setCreateBudgetOpen(false))}>
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>New Sub-Account</h3>
                <ModalCloseButton onClick={() => setCreateBudgetOpen(false)} label="Close New Sub-Account" />
              </div>
              <form onSubmit={onCreateBudget} className="modal-form-shell">
                <div className="profile-modal-body profile-field">
                  <span>Name</span>
                  <input
                    className="input"
                    placeholder="Sub-account name"
                    value={budgetName}
                    onChange={(e) => setBudgetName(e.target.value)}
                  />
                  <span>Bank account</span>
                  <select className="input" value={budgetAccountId} onChange={(e) => setBudgetAccountId(e.target.value)}>
                    <option value="" disabled>
                      Select bank account
                    </option>
                    {bankAccountsQuery.data?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <span>Monthly limit (optional)</span>
                  <NumericCalculatorInput
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={budgetTarget}
                    onValueChange={setBudgetTarget}
                  />
                </div>
                <div className="profile-actions">
                  <button className="btn btn-ghost btn-xs" type="button" onClick={() => setCreateBudgetOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-xs" type="submit" disabled={createBudget.isPending}>
                    {createBudget.isPending ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {editingBudgetId && (
          <div className="profile-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, () => setEditingBudgetId(null))}>
            <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>Edit Account</h3>
                <ModalCloseButton onClick={() => setEditingBudgetId(null)} label="Close Edit Account" />
              </div>
              <div className="modal-form-shell">
                <div className="profile-modal-body">
                <div className="profile-field">
                  <span>Name</span>
                  <input className="input" value={editingBudgetName} onChange={(e) => setEditingBudgetName(e.target.value)} />
                </div>
                <div className="profile-field">
                  <span>Monthly limit (optional)</span>
                  <NumericCalculatorInput
                    min="0"
                    step="0.01"
                    value={editingBudgetTarget}
                    onValueChange={setEditingBudgetTarget}
                  />
                </div>
                <label className="profile-field" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={editingBudgetIsSavings}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setEditingBudgetIsSavings(checked);
                      if (checked) {
                        setEditingBudgetIcon("🛡️");
                      }
                    }}
                  />
                  <span>Is this a savings sub-account?</span>
                </label>
                <div className="profile-field">
                  <span>Icon</span>
                  <div className="icon-picker">
                    {budgetIconOptions.map((icon) => (
                      <button
                        key={icon}
                        className={`icon-chip${editingBudgetIcon === icon ? " on" : ""}`}
                        onClick={() => {
                          setEditingBudgetIcon(icon);
                          setEditingBudgetIsSavings(icon === "🛡️");
                        }}
                        type="button"
                        aria-label={`Use ${icon} icon`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
                </div>
                <div className="profile-actions">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      if (editingBudgetId) confirmDeleteBudget(editingBudgetId);
                    }}
                    disabled={deleteBudget.isPending}
                  >
                    Delete
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setEditingBudgetId(null);
                      setEditingBudgetIcon("");
                    }}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-xs" onClick={saveBudgetEdit} disabled={updateBudget.isPending}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {editingBankAccount && (
          <div className="profile-modal-overlay txn-contained-modal-overlay" onMouseDown={(event) => closeOnBackdropClick(event, closeEditBankBalance)}>
            <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
              <div className="profile-modal-head">
                <h3>Edit Bank Balance</h3>
                <ModalCloseButton onClick={closeEditBankBalance} label="Close Edit Bank Balance" />
              </div>
              <form className="modal-form-shell" onSubmit={onSubmitBankBalance}>
                <div className="profile-modal-body txn-bank-balance-form">
                <div className="profile-field">
                  <span>Bank Account</span>
                  <strong>{editingBankAccount.name}</strong>
                </div>
                <div className="form-group">
                  <label className="label">Balance ({baseCurrency})</label>
                  <NumericCalculatorInput
                    step="0.01"
                    min="0"
                    value={editBankBalance}
                    onValueChange={setEditBankBalance}
                    required
                  />
                </div>
                </div>
                <div className="profile-actions">
                  <button type="button" className="btn btn-ghost" onClick={closeEditBankBalance}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={updateBankBalance.isPending}>
                    {updateBankBalance.isPending ? "Saving..." : "Save Balance"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AppShell>

    </>
  );
}
