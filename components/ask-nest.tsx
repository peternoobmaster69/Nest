"use client";

import { workspaceFetch } from "@/lib/workspace-client";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import Link from "next/link";
import {
  ArrowUpRight,
  Brain,
  CircleAlert,
  LoaderCircle,
  PencilLine,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AskNestAnswer,
  AskNestApiError,
  AskNestFeedbackRating,
  AskNestFeedbackReason,
  AskNestHistoryMessage,
  AskNestVisualization,
} from "@/lib/ai/ask-nest-types";
import { Button } from "@/components/ui/button";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { Textarea } from "@/components/ui/controls";
import { followUpToUserPrompt } from "@/lib/ai/follow-up-prompt.mjs";

type AskNestTurn = {
  id: string;
  question: string;
  answer?: AskNestAnswer;
  error?: string;
  errorCode?: string;
  pending?: boolean;
  createdAt?: string;
  feedbackRating?: AskNestFeedbackRating | null;
  feedbackReason?: AskNestFeedbackReason | null;
  feedbackPrompt?: boolean;
  feedbackPending?: boolean;
  feedbackError?: string;
};

type AskNestHistoryPage = {
  turns: AskNestTurn[];
  nextCursor: string | null;
};

type AskNestMemoryItem = {
  id: string;
  kind: "PREFERENCE" | "TERMINOLOGY" | "INSTRUCTION";
  key: string;
  content: string;
  confidence: number;
  sourceTurnId?: string | null;
  lastConfirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

class AskNestRequestError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AskNestRequestError";
    this.code = code;
  }
}

const EDITABLE_ASK_NEST_ERRORS = new Set([
  "AI_LOOKUP_LIMIT",
  "AI_LOOKUP_ROUNDS_EXHAUSTED",
  "AI_INVALID_TOOL_FILTERS",
  "AI_NO_MATCHING_DATA",
  "AI_OUTPUT_LIMIT",
  "AI_CONTENT_FILTERED",
  "AI_UNGROUNDED_VALUE",
  "AI_AMBIGUOUS_CURRENCY",
]);

const ASK_NEST_ERROR_LABELS: Record<string, string> = {
  AI_WORKSPACE_UNAVAILABLE: "Workspace unavailable",
  AI_LOOKUP_LIMIT: "Lookup limit reached",
  AI_LOOKUP_ROUNDS_EXHAUSTED: "Lookup planning did not finish",
  AI_INVALID_TOOL_FILTERS: "Invalid data filters",
  AI_DATA_TOOL_UNAVAILABLE: "Data source unavailable",
  AI_NO_MATCHING_DATA: "No matching records",
  AI_OUTPUT_LIMIT: "Answer exceeded the output limit",
  AI_CONTENT_FILTERED: "Response stopped by content safety",
  AI_MODEL_GENERATION_FAILED: "Azure AI generation failed",
  AI_EMPTY_RESPONSE: "No response from Azure AI",
  AI_INVALID_RESPONSE: "Response format could not be verified",
  AI_UNGROUNDED_VALUE: "Unsupported financial value blocked",
  AI_AMBIGUOUS_CURRENCY: "Currency could not be verified",
  AI_TIMEOUT: "Request timed out",
  AI_UNAVAILABLE: "Azure AI unavailable",
  AI_PROVIDER_RATE_LIMITED: "Azure AI is busy",
};

function askNestErrorLabel(code?: string) {
  return code ? ASK_NEST_ERROR_LABELS[code] ?? "Ask Nest could not complete the request" : "Ask Nest could not complete the request";
}

const GENERAL_QUESTIONS = [
  "What needs my attention right now?",
  "How does this month's spending compare with last month?",
  "Which card payments are due next?",
];

const NOT_USEFUL_REASONS: Array<{ value: AskNestFeedbackReason; label: string }> = [
  { value: "WRONG_DATA", label: "Wrong figures" },
  { value: "MISUNDERSTOOD", label: "Misunderstood" },
  { value: "MISSING_DETAIL", label: "Missing detail" },
  { value: "NO_RESULTS", label: "No useful results" },
  { value: "OTHER", label: "Other" },
];

function suggestedQuestions(path: string) {
  if (path.startsWith("/transactions")) {
    return [
      "What are my largest expenses this month?",
      "How does this month's spending compare with last month?",
      "Show my recent unassigned transactions.",
    ];
  }
  if (path.startsWith("/credit-transactions") || path.startsWith("/credit-cards")) {
    return [
      "Which card payments are due next?",
      "How much is outstanding across my cards?",
      "Show recent unallocated card activity.",
    ];
  }
  if (path.startsWith("/receivables")) {
    return [
      "How much is still open in receivables?",
      "Show my largest open receivables.",
      "Which receivables were added this month?",
    ];
  }
  if (path.startsWith("/budgets")) {
    return [
      "Summarize this month's budget plan.",
      "Which sub-accounts have the lowest available balance?",
      "How much remains unallocated this month?",
    ];
  }
  if (path.startsWith("/investments")) {
    return [
      "Summarize my recorded investment values.",
      "Which investment accounts have a recorded gain or loss?",
      "How much of my recorded portfolio is liquid?",
    ];
  }
  return GENERAL_QUESTIONS;
}

function getHistory(turns: AskNestTurn[]): AskNestHistoryMessage[] {
  return turns
    .filter((turn): turn is AskNestTurn & { answer: AskNestAnswer } => Boolean(turn.answer))
    .slice(-3)
    .flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer.answer },
    ]);
}

function formatAsOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
  }).format(date);
}

function renderWithFormattedDates(value: string) {
  const parts = value.split(/(\b\d{4}-\d{2}-\d{2}\b)/g);
  return parts.map((part, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return part;
    const date = new Date(`${part}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== part) return part;
    const label = new Intl.DateTimeFormat("en-SG", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    return <time className="ask-nest-inline-date" dateTime={part} title={part} key={`${part}-${index}`}>{label}</time>;
  });
}

function formatChartPeriodLabel(value: string, compact = false) {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(value);
  if (!monthMatch) return value;
  const date = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  const month = new Intl.DateTimeFormat("en-SG", { month: "short", timeZone: "UTC" }).format(date);
  return compact ? `${month} ’${monthMatch[1]!.slice(2)}` : `${month} ${monthMatch[1]}`;
}

function AskNestVisualizationView({ visualization, onNavigate, workspaceId }: {
  visualization: AskNestVisualization;
  onNavigate: () => void;
  workspaceId?: string | null;
}) {
  if (visualization.type === "trip_cards") {
    if (!visualization.items.length) return null;
    return (
      <section className="ask-nest-visual ask-nest-trip-visual" aria-label={visualization.title}>
        <h4>{visualization.title}</h4>
        <div className="ask-nest-trip-grid">
          {visualization.items.map((item) => (
            <Link key={`${item.label}-${item.href}`} href={workspaceId ? buildWorkspacePath(workspaceId, item.href) : item.href} onClick={onNavigate}>
              <span className="ask-nest-trip-flag" aria-hidden="true">{item.flag}</span>
              <span className="ask-nest-trip-copy">
                <strong>{item.label}</strong>
                <small>{renderWithFormattedDates(item.dateRange)}</small>
              </span>
              <b>{item.amount}</b>
            </Link>
          ))}
        </div>
        {visualization.disclaimer ? <p className="ask-nest-visual-disclaimer">{visualization.disclaimer}</p> : null}
      </section>
    );
  }

  if (visualization.type === "trend_chart") {
    if (!visualization.points.length) return null;
    const width = 380;
    const height = 150;
    const padding = { top: 16, right: 12, bottom: 32, left: 12 };
    const max = Math.max(1, ...visualization.points.map((point) => point.valueCents));
    const denominator = Math.max(1, visualization.points.length - 1);
    const coordinates = visualization.points.map((point, index) => ({
      ...point,
      compactLabel: formatChartPeriodLabel(point.label, true),
      readableLabel: formatChartPeriodLabel(point.label),
      x: padding.left + (index / denominator) * (width - padding.left - padding.right),
      y: padding.top + (1 - point.valueCents / max) * (height - padding.top - padding.bottom),
    }));
    const labelEvery = Math.max(1, Math.ceil(coordinates.length / 4));
    return (
      <figure className="ask-nest-visual ask-nest-chart">
        <figcaption>{visualization.title}</figcaption>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${visualization.title} in ${visualization.currency}`}>
          <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} className="ask-nest-chart-axis" />
          <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} className="ask-nest-chart-line" />
          {coordinates.map((point, index) => (
            <g key={`${point.label}-${index}`}>
              <circle cx={point.x} cy={point.y} r="4" className="ask-nest-chart-dot"><title>{`${point.readableLabel}: ${point.formattedValue}`}</title></circle>
              {(index % labelEvery === 0 || index === coordinates.length - 1) ? (
                <text x={point.x} y={height - 10} textAnchor="middle">{point.compactLabel}</text>
              ) : null}
            </g>
          ))}
        </svg>
        <dl className="ask-nest-chart-values" aria-label="Most recent chart values">
          {coordinates.slice(-3).map((point) => (
            <div key={point.label}>
              <dt>{point.readableLabel}</dt>
              <dd>{point.formattedValue}</dd>
            </div>
          ))}
        </dl>
      </figure>
    );
  }

  if (!visualization.items.length) return null;
  const max = Math.max(1, ...visualization.items.flatMap((item) => [item.investedCents, item.currentValueCents]));
  return (
    <figure className="ask-nest-visual ask-nest-investment-chart">
      <figcaption>{visualization.title}</figcaption>
      <div className="ask-nest-investment-legend"><span className="is-invested">Invested</span><span className="is-current">Current</span></div>
      <div className="ask-nest-investment-rows">
        {visualization.items.map((item) => (
          <div className="ask-nest-investment-row" key={item.id}>
            <strong>{item.label}</strong>
            <div className="ask-nest-investment-bars">
              <span className="is-invested" style={{ width: `${Math.max(2, item.investedCents / max * 100)}%` }} title={`Invested ${item.invested}`} />
              <span className="is-current" style={{ width: `${Math.max(2, item.currentValueCents / max * 100)}%` }} title={`Current ${item.currentValue}`} />
            </div>
            <small>{item.invested} → {item.currentValue}</small>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function AskNest({
  currentPath,
  pageTitle,
  workspaceName,
  workspaceId,
  userName,
}: {
  currentPath: string;
  pageTitle: string;
  workspaceName?: string | null;
  workspaceId?: string | null;
  userName?: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<AskNestTurn[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<AskNestMemoryItem[]>([]);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const memoryLoadedRef = useRef(false);
  const historyLoadedRef = useRef(false);
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prompts = useMemo(() => suggestedQuestions(currentPath), [currentPath]);
  const greetingName = userName?.trim().split(/\s+/)[0] || "";
  const isPending = turns.some((turn) => turn.pending);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    setHistoryLoading(true);
    setHistoryError("");
    void workspaceFetch("/api/ai/history?limit=10", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as AskNestHistoryPage | { error?: string } | null;
        if (!response.ok || !payload || !("turns" in payload)) {
          throw new Error(payload && "error" in payload && payload.error ? payload.error : "Could not load conversation history.");
        }
        setTurns(payload.turns);
        setNextCursor(payload.nextCursor);
      })
      .catch((error) => {
        historyLoadedRef.current = false;
        setHistoryError(error instanceof Error ? error.message : "Could not load conversation history.");
      })
      .finally(() => setHistoryLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.documentElement.dataset.askNestOpen = "true";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      delete document.documentElement.dataset.askNestOpen;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;
      if (preserveScrollRef.current) {
        const previous = preserveScrollRef.current;
        preserveScrollRef.current = null;
        content.scrollTop = previous.top + (content.scrollHeight - previous.height);
      } else {
        content.scrollTop = content.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = () => {
    abortRef.current?.abort();
    setMemoryOpen(false);
    setOpen(false);
  };

  const loadMemories = async () => {
    if (memoryLoading) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const response = await workspaceFetch("/api/ai/memory", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { memories?: AskNestMemoryItem[]; error?: string } | null;
      if (!response.ok || !payload?.memories) throw new Error(payload?.error || "Could not load memory.");
      setMemories(payload.memories);
      setMemoryDrafts(Object.fromEntries(payload.memories.map((memory) => [memory.id, memory.content])));
      memoryLoadedRef.current = true;
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Could not load memory.");
    } finally {
      setMemoryLoading(false);
    }
  };

  const showMemory = () => {
    setMemoryOpen(true);
    if (!memoryLoadedRef.current) void loadMemories();
  };

  const saveMemory = async (memory: AskNestMemoryItem) => {
    const content = memoryDrafts[memory.id]?.trim() ?? "";
    if (content.length < 3 || content === memory.content || memoryLoading) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const response = await workspaceFetch("/api/ai/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ id: memory.id, content }),
      });
      const payload = await response.json().catch(() => null) as { memory?: AskNestMemoryItem; error?: string } | null;
      if (!response.ok || !payload?.memory) throw new Error(payload?.error || "Could not update memory.");
      setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, ...payload.memory } : item));
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Could not update memory.");
    } finally {
      setMemoryLoading(false);
    }
  };

  const forgetMemory = async (memory: AskNestMemoryItem) => {
    if (!(await confirmDestructiveAction(`Forget “${memory.content}”?`, "Forget Ask Nest memory"))) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const response = await workspaceFetch(`/api/ai/memory?id=${encodeURIComponent(memory.id)}`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error("Could not forget memory.");
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setMemoryDrafts((current) => {
        const next = { ...current };
        delete next[memory.id];
        return next;
      });
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Could not forget memory.");
    } finally {
      setMemoryLoading(false);
    }
  };

  const clearMemories = async () => {
    if (!(await confirmDestructiveAction("Forget everything Ask Nest has saved about your preferences?", "Clear Ask Nest memory"))) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const response = await workspaceFetch("/api/ai/memory", { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error("Could not clear memory.");
      setMemories([]);
      setMemoryDrafts({});
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Could not clear memory.");
    } finally {
      setMemoryLoading(false);
    }
  };

  const loadOlder = async () => {
    if (!nextCursor || historyLoading) return;
    const content = contentRef.current;
    if (content) preserveScrollRef.current = { height: content.scrollHeight, top: content.scrollTop };
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await workspaceFetch(`/api/ai/history?limit=10&cursor=${encodeURIComponent(nextCursor)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as AskNestHistoryPage | { error?: string } | null;
      if (!response.ok || !payload || !("turns" in payload)) {
        throw new Error(payload && "error" in payload && payload.error ? payload.error : "Could not load older conversations.");
      }
      setTurns((current) => [...payload.turns, ...current]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      preserveScrollRef.current = null;
      setHistoryError(error instanceof Error ? error.message : "Could not load older conversations.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const clearHistory = async () => {
    if (isPending || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await workspaceFetch("/api/ai/history", { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error("Could not clear conversation history.");
      setTurns([]);
      setNextCursor(null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not clear conversation history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const ask = async (rawQuestion: string) => {
    const nextQuestion = rawQuestion.trim();
    if (nextQuestion.length < 2 || nextQuestion.length > 600 || isPending || historyLoading) return;

    const id = crypto.randomUUID();
    const history = getHistory(turns);
    setQuestion("");
    setTurns((current) => [...current, { id, question: nextQuestion, pending: true, createdAt: new Date().toISOString() }]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await workspaceFetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          question: nextQuestion,
          pagePath: currentPath,
          history,
        }),
      });
      const payload = await response.json().catch(() => null) as AskNestAnswer | AskNestApiError | null;
      if (!response.ok || !payload || "error" in payload) {
        const message = payload && "error" in payload
          ? payload.error
          : "Ask Nest could not answer right now.";
        const code = payload && "error" in payload ? payload.code : "AI_INTERNAL_ERROR";
        throw new AskNestRequestError(message, code);
      }
      setTurns((current) => current.map((turn) => (
        turn.id === id ? { ...turn, answer: payload, pending: false } : turn
      )));
      if (payload.memoryUpdates?.length) memoryLoadedRef.current = false;
    } catch (error) {
      if (controller.signal.aborted) {
        setTurns((current) => current.filter((turn) => turn.id !== id));
        return;
      }
      setTurns((current) => current.map((turn) => (
        turn.id === id
          ? {
              ...turn,
              error: error instanceof Error ? error.message : "Ask Nest could not answer right now.",
              errorCode: error instanceof AskNestRequestError ? error.code : "AI_INTERNAL_ERROR",
              pending: false,
            }
          : turn
      )));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(question);
    }
  };

  const retry = (turn: AskNestTurn) => {
    setTurns((current) => current.filter((item) => item.id !== turn.id));
    void ask(turn.question);
  };

  const editFailedQuestion = (turn: AskNestTurn) => {
    setQuestion(turn.question);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(turn.question.length, turn.question.length);
    });
  };
  const chooseFollowUp = (followUp: string) => {
    void ask(followUpToUserPrompt(followUp));
  };

  const submitFeedback = async (
    turn: AskNestTurn,
    rating: AskNestFeedbackRating,
    reason: AskNestFeedbackReason | null,
  ) => {
    const turnId = turn.answer?.turnId ?? turn.id;
    setTurns((current) => current.map((item) => item.id === turn.id
      ? { ...item, feedbackPending: true, feedbackError: "" }
      : item));
    try {
      const response = await workspaceFetch("/api/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ turnId, rating, reason }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not save feedback.");
      setTurns((current) => current.map((item) => item.id === turn.id
        ? { ...item, feedbackRating: rating, feedbackReason: reason, feedbackPrompt: false, feedbackPending: false }
        : item));
    } catch (error) {
      setTurns((current) => current.map((item) => item.id === turn.id
        ? { ...item, feedbackPending: false, feedbackError: error instanceof Error ? error.message : "Could not save feedback." }
        : item));
    }
  };

  const panel = open ? (
    <div className="ask-nest-layer">
      <Button type="button" className="ask-nest-backdrop" onClick={close} aria-label="Close Ask Nest" />
      <section
        id="ask-nest-panel"
        ref={panelRef}
        className="ask-nest-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-nest-title"
        aria-describedby="ask-nest-description"
      >
        <header className="ask-nest-header">
          <div className="ask-nest-heading-mark" aria-hidden="true"><Sparkles size={17} /></div>
          <div className="ask-nest-heading-copy">
            <h2 id="ask-nest-title">Ask Nest</h2>
            <p id="ask-nest-description">Answers from {workspaceName || "this workspace"}</p>
          </div>
          <Button
            type="button"
            className={`ask-nest-memory-toggle${memoryOpen ? " is-active" : ""}`}
            onClick={() => memoryOpen ? setMemoryOpen(false) : showMemory()}
            aria-pressed={memoryOpen}
            aria-label={memoryOpen ? "Return to Ask Nest conversation" : "Review what Ask Nest remembers"}
          >
            <Brain size={15} aria-hidden="true" />
            <span>{memoryOpen ? "Chat" : "Memory"}</span>
          </Button>
          {!memoryOpen && turns.length ? (
            <Button
              type="button"
              className="ask-nest-clear"
              onClick={() => void clearHistory()}
              disabled={isPending || historyLoading}
            >
              Clear
            </Button>
          ) : null}
          <ModalCloseButton onClick={close} label="Close Ask Nest" />
        </header>

        <div ref={contentRef} className="ask-nest-content" aria-live="polite" aria-busy={isPending || historyLoading || memoryLoading || undefined}>
          {memoryOpen ? (
            <div className="ask-nest-memory-pane">
              <div className="ask-nest-memory-intro">
                <span><Brain size={18} aria-hidden="true" /></span>
                <div>
                  <h3>What Ask Nest remembers</h3>
                  <p>Only preferences, terminology, and interaction instructions you explicitly asked Nest to remember. Financial figures are always loaded fresh.</p>
                </div>
              </div>
              {memoryError ? <div className="ask-nest-history-error" role="status">{memoryError}</div> : null}
              {memoryLoading && !memoryLoadedRef.current ? (
                <div className="ask-nest-thinking" role="status"><LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" /> Loading memory…</div>
              ) : memories.length ? (
                <div className="ask-nest-memory-list">
                  {memories.map((memory) => {
                    const draft = memoryDrafts[memory.id] ?? memory.content;
                    const changed = draft.trim() !== memory.content;
                    return (
                      <article key={memory.id} className="ask-nest-memory-item">
                        <div className="ask-nest-memory-meta">
                          <span>{memory.kind.toLocaleLowerCase()}</span>
                          <time dateTime={memory.updatedAt}>Updated {formatAsOf(memory.updatedAt)}</time>
                        </div>
                        <label htmlFor={`ask-nest-memory-${memory.id}`} className="sr-only">Edit saved {memory.kind.toLocaleLowerCase()}</label>
                        <Textarea
                          id={`ask-nest-memory-${memory.id}`}
                          value={draft}
                          rows={3}
                          maxLength={240}
                          disabled={memoryLoading}
                          onChange={(event) => setMemoryDrafts((current) => ({ ...current, [memory.id]: event.target.value }))}
                        />
                        <div className="ask-nest-memory-actions">
                          <Button type="button" onClick={() => void forgetMemory(memory)} disabled={memoryLoading}>
                            <Trash2 size={14} aria-hidden="true" /> Forget
                          </Button>
                          <Button type="button" className="is-save" onClick={() => void saveMemory(memory)} disabled={memoryLoading || !changed || draft.trim().length < 3}>
                            <Save size={14} aria-hidden="true" /> Save
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                  <Button type="button" className="ask-nest-memory-clear" onClick={() => void clearMemories()} disabled={memoryLoading}>
                    Forget everything
                  </Button>
                </div>
              ) : (
                <div className="ask-nest-memory-empty">
                  <Brain size={24} aria-hidden="true" />
                  <strong>No saved preferences yet</strong>
                  <p>Try saying: “Remember that I prefer charts for spending trends.”</p>
                </div>
              )}
            </div>
          ) : (
          <>
          {historyError ? <div className="ask-nest-history-error" role="status">{historyError}</div> : null}
          {!turns.length && historyLoading ? (
            <div className="ask-nest-thinking" role="status">
              <LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" />
              <span>Loading conversation history…</span>
            </div>
          ) : !turns.length ? (
            <div className="ask-nest-welcome">
              <span className="ask-nest-readonly-label">Read-only</span>
              <h3>{greetingName ? `Hi ${greetingName}, ask about the money already in Nest` : "Ask about the money already in Nest"}</h3>
              <p>
                Ask for comparisons, card payments, receivables, budget details, or an explanation of a bank discrepancy.
              </p>
              <div className="ask-nest-prompts" aria-label="Suggested questions">
                {prompts.map((prompt) => (
                  <Button key={prompt} type="button" onClick={() => void ask(prompt)}>
                    <span>{prompt}</span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ask-nest-thread">
              {nextCursor ? (
                <Button className="ask-nest-load-older" type="button" onClick={() => void loadOlder()} disabled={historyLoading}>
                  {historyLoading ? "Loading…" : "Load older conversations"}
                </Button>
              ) : null}
              {turns.map((turn) => (
                <article key={turn.id} className="ask-nest-turn">
                  <div className="ask-nest-question">{turn.question}</div>
                  {turn.createdAt ? <time className="ask-nest-turn-date" dateTime={turn.createdAt}>{formatAsOf(turn.createdAt)}</time> : null}
                  {turn.pending ? (
                    <div className="ask-nest-thinking" role="status">
                      <LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" />
                      <span>Checking your Nest data…</span>
                    </div>
                  ) : turn.error ? (
                    <div className="ask-nest-error" role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <div>
                        <strong>{askNestErrorLabel(turn.errorCode)}</strong>
                        <p>{turn.error}</p>
                        {turn.errorCode === "AI_WORKSPACE_UNAVAILABLE" ? (
                          <Button type="button" onClick={() => window.location.reload()}>
                            <RotateCcw size={14} aria-hidden="true" /> Refresh page
                          </Button>
                        ) : EDITABLE_ASK_NEST_ERRORS.has(turn.errorCode ?? "") ? (
                          <Button type="button" onClick={() => editFailedQuestion(turn)}>
                            <PencilLine size={14} aria-hidden="true" /> Edit question
                          </Button>
                        ) : (
                          <Button type="button" onClick={() => retry(turn)}>
                            <RotateCcw size={14} aria-hidden="true" /> Retry same question
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : turn.answer ? (
                    <div className="ask-nest-response">
                      <p className="ask-nest-answer">{renderWithFormattedDates(turn.answer.answer)}</p>
                      {turn.answer.memoryUpdates?.length ? (
                        <div className="ask-nest-memory-saved" role="status">
                          <Brain size={15} aria-hidden="true" />
                          <span><strong>Remembered</strong>{turn.answer.memoryUpdates.join(" · ")}</span>
                        </div>
                      ) : null}
                      {turn.answer.highlights.length ? (
                        <dl className="ask-nest-highlights">
                          {turn.answer.highlights.map((highlight, index) => (
                            <div key={`${highlight.label}-${index}`} className={`ask-nest-highlight is-${highlight.tone}`}>
                              <dt>{highlight.label}</dt>
                              <dd>{renderWithFormattedDates(highlight.value)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {turn.answer.visualization ? (
                        <AskNestVisualizationView visualization={turn.answer.visualization} workspaceId={workspaceId} onNavigate={() => setOpen(false)} />
                      ) : null}
                      {turn.answer.evidence.length ? (
                        <div className="ask-nest-evidence">
                          <span>Supporting data</span>
                          {turn.answer.evidence.map((item) => item.href.startsWith("https://") ? (
                            <a key={item.id} href={item.href} target="_blank" rel="noreferrer">
                              <span><strong>{item.label}</strong><small>{renderWithFormattedDates(item.detail)}</small></span>
                              <ArrowUpRight size={15} aria-hidden="true" />
                            </a>
                          ) : (
                            <Link key={item.id} href={workspaceId ? buildWorkspacePath(workspaceId, item.href) : item.href} onClick={() => setOpen(false)}>
                              <span><strong>{item.label}</strong><small>{renderWithFormattedDates(item.detail)}</small></span>
                              <ArrowUpRight size={15} aria-hidden="true" />
                            </Link>
                          ))}
                        </div>
                      ) : null}
                      <details className="ask-nest-scope">
                        <summary>Data scope</summary>
                        <p>
                          {turn.answer.scope.workspaceName} · {turn.answer.scope.currency} · {turn.answer.scope.pageTitle}
                        </p>
                        <p>Checked {formatAsOf(turn.answer.scope.asOf)}</p>
                        {turn.answer.scope.toolsUsed.length ? (
                          <p>Sources: {turn.answer.scope.toolsUsed.join(", ")}</p>
                        ) : null}
                      </details>
                      <div className="ask-nest-feedback" aria-label="Rate this Ask Nest answer">
                        {turn.feedbackRating ? (
                          <span className="ask-nest-feedback-thanks">Feedback saved · {turn.feedbackRating === "HELPFUL" ? "Helpful" : "Not useful"}</span>
                        ) : (
                          <>
                            <span>Was this useful?</span>
                            <Button
                              type="button"
                              onClick={() => void submitFeedback(turn, "HELPFUL", null)}
                              disabled={turn.feedbackPending}
                              aria-label="Mark this answer as helpful"
                            >
                              <ThumbsUp size={14} aria-hidden="true" /> Helpful
                            </Button>
                            <Button
                              type="button"
                              onClick={() => setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, feedbackPrompt: !item.feedbackPrompt, feedbackError: "" } : item))}
                              disabled={turn.feedbackPending}
                              aria-expanded={Boolean(turn.feedbackPrompt)}
                            >
                              <ThumbsDown size={14} aria-hidden="true" /> Not useful
                            </Button>
                          </>
                        )}
                        {turn.feedbackPrompt && !turn.feedbackRating ? (
                          <div className="ask-nest-feedback-reasons" aria-label="Why was this answer not useful?">
                            {NOT_USEFUL_REASONS.map((reason) => (
                              <Button
                                key={reason.value}
                                type="button"
                                onClick={() => void submitFeedback(turn, "NOT_HELPFUL", reason.value)}
                                disabled={turn.feedbackPending}
                              >
                                {reason.label}
                              </Button>
                            ))}
                          </div>
                        ) : null}
                        {turn.feedbackError ? <small role="alert">{turn.feedbackError}</small> : null}
                      </div>
                      {turn.answer.followUpQuestions.length ? (
                        <div className="ask-nest-followups" aria-label="Suggested next questions">
                          <div className="ask-nest-followups-heading">
                            <strong>Suggested next questions</strong>
                            <span>Select one to ask it now.</span>
                          </div>
                          <div className="ask-nest-followups-list">
                            {turn.answer.followUpQuestions.map((followUp) => (
                              <Button
                                key={followUp}
                                type="button"
                                onClick={() => chooseFollowUp(followUp)}
                                disabled={isPending || historyLoading}
                                aria-label={`Ask suggested question: ${followUp}`}
                              >
                                <span>{followUp}</span>
                                <i aria-hidden="true">&rarr;</i>
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          </>
          )}
        </div>

        {!memoryOpen ? <footer className="ask-nest-footer">
          <form className="ask-nest-form" onSubmit={onSubmit}>
            <div className="ask-nest-input-shell">
              <label htmlFor="ask-nest-input" className="sr-only">Ask a question about your Nest data</label>
              <Textarea
                ref={inputRef}
                id="ask-nest-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value.slice(0, 600))}
                onKeyDown={onInputKeyDown}
                placeholder={`Ask about ${pageTitle.toLowerCase()}…`}
                rows={2}
                disabled={isPending || historyLoading}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              iconOnly
              className="ask-nest-send"
              disabled={isPending || historyLoading || question.trim().length < 2}
              aria-label="Send question"
            >
              {isPending ? <LoaderCircle size={18} className="ask-nest-spinner" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            </Button>
          </form>
          <p>Read-only · Figures come from Nest records and may still need review.</p>
        </footer> : (
          <footer className="ask-nest-footer ask-nest-memory-footer">
            <Button type="button" variant="secondary" onClick={() => setMemoryOpen(false)}>Back to conversation</Button>
          </footer>
        )}
      </section>
    </div>
  ) : null;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className="ask-nest-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="ask-nest-panel"
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>Ask Nest</span>
      </Button>
      {mounted && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
