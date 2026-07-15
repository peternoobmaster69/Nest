"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AskNestAnswer,
  AskNestApiError,
  AskNestHistoryMessage,
} from "@/lib/ai/ask-nest-types";
import { Button } from "@/components/ui/button";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

type AskNestTurn = {
  id: number;
  question: string;
  answer?: AskNestAnswer;
  error?: string;
  pending?: boolean;
};

const GENERAL_QUESTIONS = [
  "What needs my attention right now?",
  "How does this month's spending compare with last month?",
  "Which card payments are due next?",
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AskNest({
  currentPath,
  pageTitle,
  workspaceName,
}: {
  currentPath: string;
  pageTitle: string;
  workspaceName?: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<AskNestTurn[]>([]);
  const nextId = useRef(1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prompts = useMemo(() => suggestedQuestions(currentPath), [currentPath]);
  const isPending = turns.some((turn) => turn.pending);

  useEffect(() => setMounted(true), []);

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
      if (content) content.scrollTop = content.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
  };

  const ask = async (rawQuestion: string) => {
    const nextQuestion = rawQuestion.trim();
    if (nextQuestion.length < 2 || nextQuestion.length > 600 || isPending) return;

    const id = nextId.current++;
    const history = getHistory(turns);
    setQuestion("");
    setTurns((current) => [...current, { id, question: nextQuestion, pending: true }]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/ask", {
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
        throw new Error(message);
      }
      setTurns((current) => current.map((turn) => (
        turn.id === id ? { ...turn, answer: payload, pending: false } : turn
      )));
    } catch (error) {
      if (controller.signal.aborted) {
        setTurns((current) => current.filter((turn) => turn.id !== id));
        return;
      }
      setTurns((current) => current.map((turn) => (
        turn.id === id
          ? { ...turn, error: error instanceof Error ? error.message : "Ask Nest could not answer right now.", pending: false }
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

  const panel = open ? (
    <div className="ask-nest-layer">
      <button type="button" className="ask-nest-backdrop" onClick={close} aria-label="Close Ask Nest" />
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
          {turns.length ? (
            <button
              type="button"
              className="ask-nest-clear"
              onClick={() => setTurns([])}
              disabled={isPending}
            >
              Clear
            </button>
          ) : null}
          <ModalCloseButton onClick={close} label="Close Ask Nest" />
        </header>

        <div ref={contentRef} className="ask-nest-content" aria-live="polite" aria-busy={isPending || undefined}>
          {!turns.length ? (
            <div className="ask-nest-welcome">
              <span className="ask-nest-readonly-label">Read-only</span>
              <h3>Ask about the money already in Nest</h3>
              <p>
                Ask for comparisons, card obligations, receivables, budget details, or an explanation of a bank discrepancy.
              </p>
              <div className="ask-nest-prompts" aria-label="Suggested questions">
                {prompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => void ask(prompt)}>
                    <span>{prompt}</span>
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ask-nest-thread">
              {turns.map((turn) => (
                <article key={turn.id} className="ask-nest-turn">
                  <div className="ask-nest-question">{turn.question}</div>
                  {turn.pending ? (
                    <div className="ask-nest-thinking" role="status">
                      <LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" />
                      <span>Checking your Nest data…</span>
                    </div>
                  ) : turn.error ? (
                    <div className="ask-nest-error" role="alert">
                      <CircleAlert size={18} aria-hidden="true" />
                      <div>
                        <p>{turn.error}</p>
                        <button type="button" onClick={() => retry(turn)}>
                          <RotateCcw size={14} aria-hidden="true" /> Try again
                        </button>
                      </div>
                    </div>
                  ) : turn.answer ? (
                    <div className="ask-nest-response">
                      <p className="ask-nest-answer">{turn.answer.answer}</p>
                      {turn.answer.highlights.length ? (
                        <dl className="ask-nest-highlights">
                          {turn.answer.highlights.map((highlight, index) => (
                            <div key={`${highlight.label}-${index}`} className={`ask-nest-highlight is-${highlight.tone}`}>
                              <dt>{highlight.label}</dt>
                              <dd>{highlight.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {turn.answer.evidence.length ? (
                        <div className="ask-nest-evidence">
                          <span>Supporting data</span>
                          {turn.answer.evidence.map((item) => (
                            <Link key={item.id} href={item.href} onClick={() => setOpen(false)}>
                              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
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
                      {turn.answer.followUpQuestions.length ? (
                        <div className="ask-nest-followups" aria-label="Follow-up questions">
                          {turn.answer.followUpQuestions.map((followUp) => (
                            <button key={followUp} type="button" onClick={() => void ask(followUp)} disabled={isPending}>
                              {followUp}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="ask-nest-footer">
          <form className="ask-nest-form" onSubmit={onSubmit}>
            <label htmlFor="ask-nest-input" className="sr-only">Ask a question about your Nest data</label>
            <textarea
              ref={inputRef}
              id="ask-nest-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, 600))}
              onKeyDown={onInputKeyDown}
              placeholder={`Ask about ${pageTitle.toLowerCase()}…`}
              rows={2}
              disabled={isPending}
            />
            <Button
              type="submit"
              variant="primary"
              iconOnly
              className="ask-nest-send"
              disabled={isPending || question.trim().length < 2}
              aria-label="Send question"
            >
              {isPending ? <LoaderCircle size={18} className="ask-nest-spinner" aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            </Button>
          </form>
          <p>Read-only · Figures come from Nest records and may still need review.</p>
        </footer>
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
