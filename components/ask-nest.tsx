"use client";

import "@/app/styles/ask-nest.css";
import "@/app/styles/transaction-agent.css";
import "@/app/styles/ask-nest-mascot.css";

import { suggestedQuestions } from "@/lib/ai/ask-nest-prompts";
import { draftPlaceholder, draftSummary, TransactionAgentCard, useTransactionAgent, type AgentSession } from "@/components/transaction-agent";
import { AskNestVisualizationView, formatAsOf, renderWithFormattedDates } from "@/components/ask-nest-visualization";
import { couldBeTransaction, isTransactionRequest } from "@/lib/ai/transaction-request";
import { workspaceFetch } from "@/lib/workspace-client";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import Link from "next/link";
import {
  ArrowUpRight,
  Brain,
  CircleAlert,
  LoaderCircle,
  Minus,
  PencilLine,
  ReceiptText,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { SubmitEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AskNestAnswer,
  AskNestApiError,
  AskNestFeedbackRating,
  AskNestFeedbackReason,
  AskNestHistoryMessage,
} from "@/lib/ai/ask-nest-types";
import { Button } from "@/components/ui/button";
import { AskNestFab, type NestlingMood } from "@/components/ask-nest-mascot";
import { claimAskNestFlag, releaseAskNestFlag, claimAskNestWorkspace, useAskNestLauncher, useAskNestState } from "@/components/ask-nest-store";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { usePrivacyMode } from "@/lib/privacy-mode";
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

const RECORD_EXAMPLES = ["Deduct $10", "Spent $12.50 on lunch yesterday", "Change yesterday’s lunch to $12"];

const NOT_USEFUL_REASONS: Array<{ value: AskNestFeedbackReason; label: string }> = [
  { value: "WRONG_DATA", label: "Wrong figures" },
  { value: "MISUNDERSTOOD", label: "Misunderstood" },
  { value: "MISSING_DETAIL", label: "Missing detail" },
  { value: "NO_RESULTS", label: "No useful results" },
  { value: "OTHER", label: "Other" },
];

const NO_TURNS: AskNestTurn[] = [];

function getHistory(turns: AskNestTurn[]): AskNestHistoryMessage[] {
  return turns
    .filter((turn): turn is AskNestTurn & { answer: AskNestAnswer } => Boolean(turn.answer))
    .slice(-3)
    .flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer.answer },
    ]);
}

export function AskNest({
  currentPath,
  pageTitle,
  workspaceName,
  workspaceId,
  userName,
}: Readonly<{
  currentPath: string;
  pageTitle: string;
  workspaceName?: string | null;
  workspaceId?: string | null;
  userName?: string | null;
}>) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  // Minimizing keeps the conversation (and any in-flight answer) alive behind a floating launcher
  // that follows the user to every page until they dismiss it.
  claimAskNestWorkspace(workspaceId);
  const [minimized, setMinimized] = useAskNestLauncher();
  const [hasNews, setHasNews] = useAskNestState("hasNews", false);
  usePrivacyMode(); // Draft summaries in the launcher bubble format money.
  const fabRef = useRef<HTMLButtonElement>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useAskNestState("turns", NO_TURNS);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [nextCursor, setNextCursor] = useAskNestState<string | null>("nextCursor", null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<AskNestMemoryItem[]>([]);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const memoryLoadedRef = useRef(false);
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prompts = useMemo(() => suggestedQuestions(currentPath), [currentPath]);
  const greetingName = userName?.trim().split(/\s+/)[0] || "";
  const agent = useTransactionAgent(workspaceId, open || minimized);
  const activeDraft = agent.active;
  const isPending = turns.some((turn) => turn.pending);
  const composerLocked = isPending || historyLoading || agent.busy || Boolean(activeDraft?.needsReload);
  // Questions and transaction drafts share one thread, in the order they were started.
  const thread = useMemo(() => [
    ...turns.map((turn, index) => ({ kind: "turn" as const, at: turn.createdAt ?? "", index, turn })),
    ...agent.sessions.map((session, index) => ({ kind: "draft" as const, at: session.createdAt, index: turns.length + index, session })),
  ].sort((a, b) => (a.at && b.at && a.at !== b.at ? a.at.localeCompare(b.at) : a.index - b.index)), [turns, agent.sessions]);
  const latestSessionKey = agent.sessions.at(-1)?.key;
  const working = isPending || agent.busy;
  const showFab = minimized && !open;
  const fabMood: NestlingMood = working ? "thinking" : hasNews ? "news" : activeDraft ? "drafting" : "idle";
  const fabStatus = working ? "Working on it…"
    : hasNews ? "Your answer is ready"
    : activeDraft ? `Draft waiting · ${draftSummary(activeDraft)}`
    : "Our conversation is still here";
  const wasWorkingRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const historyKey = "history";
    if (!open || !claimAskNestFlag(historyKey)) return;
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
        releaseAskNestFlag(historyKey);
        setHistoryError(error instanceof Error ? error.message : "Could not load conversation history.");
      })
      .finally(() => setHistoryLoading(false));
  }, [open, setNextCursor, setTurns]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        minimize();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
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


  // Leaving the page with the panel open (back button, sidebar) still leaves the launcher behind.
  useEffect(() => {
    if (open) return () => setMinimized(true);
  }, [open, setMinimized]);

  // An answer or draft that finishes while minimized gets a badge on the launcher.
  useEffect(() => {
    if (wasWorkingRef.current && !working && !open) setHasNews(true);
    wasWorkingRef.current = working;
  }, [working, open, setHasNews]);

  useEffect(() => {
    if (open) setHasNews(false);
  }, [open, setHasNews]);

  useEffect(() => {
    if (!showFab) return;
    document.documentElement.dataset.askNestMinimized = "true";
    return () => { delete document.documentElement.dataset.askNestMinimized; };
  }, [showFab]);

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
  }, [open, turns, agent.sessions, agent.busy]);

  useEffect(() => {
    if (open && !composerLocked && !memoryOpen) inputRef.current?.focus();
  }, [open, composerLocked, memoryOpen]);

  // In-flight answers are not aborted on unmount: they land in the shared store on the next page.

  function minimize() {
    setMemoryOpen(false);
    setMinimized(true);
    setOpen(false);
    window.requestAnimationFrame(() => fabRef.current?.focus());
  }

  const reopen = () => {
    setMinimized(false);
    setOpen(true);
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
      agent.clearFinished();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not clear conversation history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  /** Requests to change money start a draft in the thread; everything else is answered read-only. */
  const ask = async (rawQuestion: string, asQuestion = false) => {
    const nextQuestion = rawQuestion.trim();
    if (nextQuestion.length < 2 || nextQuestion.length > 600 || isPending || historyLoading) return;
    if (!asQuestion && isTransactionRequest(nextQuestion)) {
      setQuestion("");
      // One draft at a time: a new command while one is open refines that draft.
      if (activeDraft) agent.reply(nextQuestion);
      else agent.start(nextQuestion, true);
      return;
    }
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

  // While a draft is open the composer replies to it, so short answers like "2" or "yesterday" work.
  const submitComposer = () => {
    const text = question.trim();
    if (!activeDraft) return void ask(question);
    if (!text || composerLocked) return;
    setQuestion("");
    agent.reply(text);
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    submitComposer();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitComposer();
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
  const askInstead = async (session: AgentSession) => {
    if (await agent.discard(session)) void ask(session.text, true);
  };

  const recordInstead = (turn: AskNestTurn) => agent.start(turn.question);

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

  const renderTurn = (turn: AskNestTurn) => (
    <article key={turn.id} className="ask-nest-turn">
      <div className="ask-nest-question">{turn.question}</div>
      {turn.createdAt ? <time className="ask-nest-turn-date" dateTime={turn.createdAt}>{formatAsOf(turn.createdAt)}</time> : null}
      {turn.pending ? (
        <output className="ask-nest-thinking">
          <LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" />
          <span>Checking your Nest data…</span>
        </output>
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
            <output className="ask-nest-memory-saved">
              <Brain size={15} aria-hidden="true" />
              <span><strong>Remembered</strong>{turn.answer.memoryUpdates.join(" · ")}</span>
            </output>
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
            <AskNestVisualizationView visualization={turn.answer.visualization} workspaceId={workspaceId} onNavigate={minimize} />
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
                <Link key={item.id} href={workspaceId ? buildWorkspacePath(workspaceId, item.href) : item.href} onClick={minimize}>
                  <span><strong>{item.label}</strong><small>{renderWithFormattedDates(item.detail)}</small></span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : null}
          {turn.answer.followUpQuestions.length ? (
            <div className="ask-nest-followups" aria-label="Suggested next actions">
              <div className="ask-nest-followups-heading">
                <strong>Suggested next actions</strong>
                <span>Select an action to run it now.</span>
              </div>
              <div className="ask-nest-followups-list">
                {turn.answer.followUpQuestions.map((followUp) => {
                  const action = followUpToUserPrompt(followUp);
                  return (
                    <Button
                      key={action}
                      type="button"
                      onClick={() => chooseFollowUp(action)}
                      disabled={isPending || historyLoading || agent.busy}
                      aria-label={`Run suggested action: ${action}`}
                    >
                      <span>{action}</span>
                      <i aria-hidden="true">&rarr;</i>
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="ask-nest-answer-meta">
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
                  <span className="ask-nest-feedback-label">Was this useful?</span>
                  <Button
                    type="button"
                    onClick={() => void submitFeedback(turn, "HELPFUL", null)}
                    disabled={turn.feedbackPending}
                    aria-label="Mark this answer as helpful"
                  >
                    <ThumbsUp size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setTurns((current) => current.map((item) => item.id === turn.id ? { ...item, feedbackPrompt: !item.feedbackPrompt, feedbackError: "" } : item))}
                    disabled={turn.feedbackPending}
                    aria-expanded={Boolean(turn.feedbackPrompt)}
                    aria-label="Mark this answer as not useful"
                  >
                    <ThumbsDown size={14} aria-hidden="true" />
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
            {couldBeTransaction(turn.question) ? (
              <Button type="button" variant="ghost" size="sm" className="ask-nest-record-instead" onClick={() => recordInstead(turn)} disabled={agent.busy || Boolean(activeDraft)}>
                <ReceiptText size={14} aria-hidden="true" /> Record this instead
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );

  const panel = open ? (
    <div className="ask-nest-layer">
      <Button type="button" className="ask-nest-backdrop" onClick={minimize} aria-label="Minimize Ask Nest" />
      <dialog open
        id="ask-nest-panel"
        ref={panelRef}
        className="ask-nest-panel"
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
            onClick={() => { if (memoryOpen) setMemoryOpen(false); else showMemory(); }}
            aria-pressed={memoryOpen}
            aria-label={memoryOpen ? "Return to Ask Nest conversation" : "Review what Ask Nest remembers"}
          >
            <Brain size={15} aria-hidden="true" />
            <span>{memoryOpen ? "Chat" : "Memory"}</span>
          </Button>
          {!memoryOpen && (turns.length || agent.sessions.length) ? (
            <Button
              type="button"
              className="ask-nest-clear"
              onClick={() => void clearHistory()}
              disabled={isPending || historyLoading || agent.busy}
              aria-label="Clear conversation history"
            >
              Clear
            </Button>
          ) : null}
          <Button type="button" className="modal-close ask-nest-minimize" iconOnly onClick={minimize} aria-label="Minimize Ask Nest" title="Minimize. Your conversation stays here.">
            <Minus size={18} aria-hidden="true" />
          </Button>
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
              {memoryError ? <output className="ask-nest-history-error">{memoryError}</output> : null}
              {memoryLoading && !memoryLoadedRef.current ? (
                <output className="ask-nest-thinking"><LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" /> Loading memory…</output>
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
          {historyError ? <output className="ask-nest-history-error">{historyError}</output> : null}
          {!turns.length && historyLoading ? (
            <output className="ask-nest-thinking">
              <LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" />
              <span>Loading conversation history…</span>
            </output>
          ) : !thread.length ? (
            <div className="ask-nest-welcome">
              <span className="ask-nest-readonly-label">Read-only answers · You confirm every change</span>
              <h3>{greetingName ? `Hi ${greetingName}, ask about the money already in Nest` : "Ask about the money already in Nest"}</h3>
              <p>
                Ask for comparisons, card payments, receivables, budget details, or a bank discrepancy. You can also record or correct a transaction in plain words. Nothing is saved until you confirm the review.
              </p>
              <div className="ask-nest-prompts" aria-label="Suggested questions">
                {prompts.map((prompt) => (
                  <Button key={prompt} type="button" onClick={() => void ask(prompt)}>
                    <span>{prompt}</span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Button>
                ))}
              </div>
              <div className="ask-nest-prompts ask-nest-record-prompts" aria-label="Record a transaction">
                <span className="ask-nest-prompts-label">Or record something</span>
                {RECORD_EXAMPLES.map((example) => (
                  <Button key={example} type="button" disabled={agent.busy} onClick={() => agent.start(example)}>
                    <span>{example}</span>
                    <ReceiptText size={15} aria-hidden="true" />
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
              {thread.map((item) => item.kind === "draft" ? (
                <TransactionAgentCard key={item.session.key} session={item.session} agent={agent} latest={item.session.key === latestSessionKey}
                  typing={Boolean(question.trim())} workspaceId={workspaceId} onNavigate={minimize} onAskInstead={(session) => void askInstead(session)} />
              ) : renderTurn(item.turn))}
            </div>
          )}
          </>
          )}
        </div>

        {!memoryOpen ? <footer className="ask-nest-footer">
          {activeDraft ? (
            <output className="ask-nest-draft-strip">
              <ReceiptText size={15} aria-hidden="true" />
              <span><strong>Drafting</strong>{draftSummary(activeDraft)}</span>
              <Button type="button" variant="ghost" size="sm" disabled={agent.busy} onClick={() => void agent.discard(activeDraft)}>
                <X size={14} aria-hidden="true" /> Cancel
              </Button>
            </output>
          ) : null}
          <form className="ask-nest-form" onSubmit={onSubmit}>
            <div className="ask-nest-input-shell">
              <label htmlFor="ask-nest-input" className="sr-only">{activeDraft ? "Reply to the transaction draft" : "Ask a question or describe a transaction"}</label>
              <Textarea
                ref={inputRef}
                id="ask-nest-input"
                value={question}
                onChange={(event) => setQuestion(event.target.value.slice(0, 600))}
                onKeyDown={onInputKeyDown}
                placeholder={activeDraft ? draftPlaceholder(activeDraft) : `Ask about ${pageTitle.toLowerCase()}, or say “spent $12 on lunch”`}
                rows={2}
                disabled={composerLocked}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              iconOnly
              className="ask-nest-send"
              disabled={composerLocked || question.trim().length < (activeDraft ? 1 : 2)}
              aria-label={activeDraft ? "Send reply" : "Send"}
            >
              {isPending || agent.busy ? <LoaderCircle size={18} className="ask-nest-spinner" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            </Button>
          </form>
          <p>{activeDraft ? "Nothing is saved until you press Confirm. Drafts expire after 30 minutes." : "Read-only · Figures come from Nest records and may still need review."}</p>
        </footer> : (
          <footer className="ask-nest-footer ask-nest-memory-footer">
            <Button type="button" variant="secondary" onClick={() => setMemoryOpen(false)}>Back to conversation</Button>
          </footer>
        )}
      </dialog>
    </div>
  ) : null;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className="ask-nest-trigger"
        onClick={reopen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="ask-nest-panel"
      >
        <Sparkles size={16} aria-hidden="true" />
        <span>Ask Nest</span>
      </Button>
      {mounted && panel ? createPortal(panel, document.body) : null}
      {mounted && showFab ? createPortal(
        <AskNestFab ref={fabRef} mood={fabMood} status={fabStatus} onOpen={reopen} onDismiss={() => { setMinimized(false); setHasNews(false); }} />,
        document.body,
      ) : null}
    </>
  );
}
