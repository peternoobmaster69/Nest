"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { LoaderCircle, MessageCircleQuestion, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { workspaceFetch } from "@/lib/workspace-client";
import { buildWorkspacePath } from "@/lib/workspace-entry";
import { invalidateWorkspaceQueries } from "@/lib/query-keys";
import type { TransactionAgentRequest, TransactionAgentView } from "@/lib/ai/transaction-agent-contracts";
import { agentMoney, TransactionAgentReview } from "./transaction-agent-review";

/** One transaction draft shown inline in the Ask Nest thread. */
export type AgentSession = {
  key: string;
  createdAt: string;
  text: string;
  view: TransactionAgentView | null;
  error: string;
  needsReload: boolean;
  /** Ask Nest routed this message automatically, so offer to answer it as a question instead. */
  routed: boolean;
};

export const isActiveDraft = (session?: AgentSession | null) => session?.view?.status === "CLARIFY" || session?.view?.status === "REVIEW";

const PENDING_LABELS: Record<string, string> = {
  budget: "Choose a sub-account", amount: "Needs an amount", direction: "Deduct or add?",
  subject: "Needs a description", date: "Needs a date", target: "Choose the transaction",
};

export function draftSummary(session: AgentSession) {
  const view = session.view;
  if (view?.review) return `${view.review.after.subject} · ${agentMoney(view.review.after.amountCents, view.review.currency)}`;
  return (view?.pending && PENDING_LABELS[view.pending]) || "Drafting a transaction";
}

export function draftPlaceholder(session: AgentSession) {
  if (session.view?.pending === "budget") return "Type a number or sub-account name…";
  if (session.view?.status === "REVIEW") return "Type a change, like “make it $15”…";
  return "Reply, or type 12.50 / yesterday…";
}

async function readView(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || fallback);
  return data as TransactionAgentView;
}

export function useTransactionAgent(workspaceId: string | null | undefined, enabled: boolean) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const restoredRef = useRef(false);
  const queryClient = useQueryClient();
  const storageKey = `nest:transaction-agent:${workspaceId ?? "active"}`;

  const patch = useCallback((key: string, next: Partial<AgentSession>) => {
    setSessions((current) => current.map((session) => session.key === key ? { ...session, ...next } : session));
  }, []);

  const remember = useCallback((view: TransactionAgentView) => {
    try {
      // Only unfinished drafts are restored when Ask Nest reopens.
      if (view.status === "CLARIFY" || view.status === "REVIEW") window.sessionStorage.setItem(storageKey, view.draftId);
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* Storage is optional. */ }
  }, [storageKey]);

  const accept = useCallback((key: string, view: TransactionAgentView) => {
    patch(key, { view, needsReload: false });
    remember(view);
    if (view.status === "SAVED") void invalidateWorkspaceQueries(queryClient);
  }, [patch, queryClient, remember]);

  const fetchDraft = useCallback(async (draftId: string) => readView(
    await workspaceFetch(`/api/ai/transactions?draftId=${encodeURIComponent(draftId)}`, { cache: "no-store" }),
    "Could not reload this draft.",
  ), []);

  const lock = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const unlock = () => { busyRef.current = false; setBusy(false); };

  const run = useCallback(async (key: string, request: TransactionAgentRequest) => {
    if (!lock()) return false;
    patch(key, { error: "" });
    try {
      accept(key, await readView(await workspaceFetch("/api/ai/transactions", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      }), "Could not complete this request."));
      return true;
    } catch (cause) {
      patch(key, { error: cause instanceof Error ? cause.message : "Could not complete this request." });
      if ("draftId" in request) {
        // Keep the draft locked until its real status is known, so a failed confirmation cannot be repeated blindly.
        patch(key, { needsReload: true });
        try {
          const fresh = await fetchDraft(request.draftId);
          accept(key, fresh);
          if (fresh.status === "SAVED") patch(key, { error: "" });
        } catch { /* Reload stays required. */ }
      }
      return false;
    } finally {
      unlock();
    }
  }, [accept, fetchDraft, patch]);

  const reload = useCallback(async (key: string, draftId: string) => {
    if (!lock()) return;
    try {
      accept(key, await fetchDraft(draftId));
      patch(key, { error: "" });
    } catch {
      patch(key, { error: "Could not reload the draft. Please try again." });
    } finally {
      unlock();
    }
  }, [accept, fetchDraft, patch]);

  // Drafts belong to one workspace, so switching workspaces starts a clean thread.
  useEffect(() => {
    setSessions([]);
    restoredRef.current = false;
  }, [storageKey]);

  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    let draftId: string | null = null;
    try { draftId = window.sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    if (!draftId || !lock()) return;
    const key = crypto.randomUUID();
    setSessions((current) => [...current, { key, createdAt: new Date().toISOString(), text: "", view: null, error: "", needsReload: false, routed: false }]);
    void fetchDraft(draftId).then((view) => {
      if (view.status === "CLARIFY" || view.status === "REVIEW") accept(key, view);
      else throw new Error("finished");
    }).catch(() => {
      setSessions((current) => current.filter((session) => session.key !== key));
      try { window.sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
    }).finally(unlock);
  }, [accept, enabled, fetchDraft, storageKey]);

  const active = [...sessions].reverse().find(isActiveDraft) ?? null;

  const start = (text: string, routed = false) => {
    if (busyRef.current || active) return;
    const key = crypto.randomUUID();
    // Remembering the last saved draft lets "make that $12" correct what was just saved.
    const lastSaved = [...sessions].reverse().find((session) => session.view?.status === "SAVED")?.view;
    setSessions((current) => [...current, { key, createdAt: new Date().toISOString(), text, view: null, error: "", needsReload: false, routed }]);
    void run(key, { action: "start", message: text, ...(lastSaved ? { previousDraftId: lastSaved.draftId } : {}) });
  };

  const reply = (text: string) => {
    if (!active?.view) return;
    void run(active.key, { action: "message", draftId: active.view.draftId, revision: active.view.revision, message: text });
  };

  /** Cancels the draft if it is still open and removes it from the thread. */
  const discard = async (session: AgentSession) => {
    if (isActiveDraft(session) && session.view) {
      const cancelled = await run(session.key, { action: "cancel", draftId: session.view.draftId, revision: session.view.revision });
      if (!cancelled) return false;
    }
    setSessions((current) => current.filter((item) => item.key !== session.key));
    return true;
  };

  const clearFinished = () => setSessions((current) => current.filter(isActiveDraft));

  return { sessions, active, busy, start, reply, run, reload, discard, clearFinished };
}

export type TransactionAgentController = ReturnType<typeof useTransactionAgent>;

type CardProps = {
  session: AgentSession;
  agent: TransactionAgentController;
  latest: boolean;
  typing: boolean;
  workspaceId?: string | null;
  onNavigate: () => void;
  onAskInstead: (session: AgentSession) => void;
};

function sessionMessages(session: AgentSession): TransactionAgentView["messages"] {
  if (session.view?.messages.length) return session.view.messages;
  return session.text ? [{ role: "user", content: session.text }] : [];
}

function TransactionAgentMessages({ session }: Readonly<{ session: AgentSession }>) {
  const occurrences = new Map<string, number>();
  return sessionMessages(session).map((item) => {
    const identity = JSON.stringify([item.role, item.content]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const key = `${identity}:${occurrence}`;
    return item.role === "user"
      ? <div key={key} className="ask-nest-question">{item.content}</div>
      : <p key={key} className="transaction-agent-reply">{item.content}</p>;
  });
}

const DRAFT_STATUS_LABELS: Record<TransactionAgentView["status"], string> = {
  CLARIFY: "Transaction draft · nothing saved yet",
  REVIEW: "Transaction draft · nothing saved yet",
  SAVED: "Saved",
  CANCELLED: "Draft cancelled",
  EXPIRED: "Draft expired",
};

type SendRequest = (request: TransactionAgentRequest) => void;

function TransactionAgentPicker({ draft, active, locked, filter, onFilter, onSend }: Readonly<{
  draft: TransactionAgentView | null;
  active: boolean;
  locked: boolean;
  filter: string;
  onFilter: (value: string) => void;
  onSend: SendRequest;
}>) {
  if (!active || !draft?.choices.length) return null;
  const choices = draft.choices;
  const reference = { draftId: draft.draftId, revision: draft.revision };
  const suggestionsOnly = draft.pending === "budget" && choices.every((choice) => choice.kind === "budget" && choice.suggested);
  return <div className="transaction-agent-picker">
      {choices.length > 6 ? <label>Find a sub-account or transaction<Input className="transaction-agent-filter" type="search" value={filter} onChange={(e) => onFilter(e.target.value)} /></label> : null}
      <div className="transaction-agent-choices" aria-label="Choose a sub-account or transaction">
        {choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => `${choice.label} ${choice.detail}`.toLowerCase().includes(filter.toLowerCase())).map(({ choice, index }) => <Button key={`${choice.kind}-${choice.id}`} disabled={locked} onClick={() => onSend({ action: "select", ...reference, selection: { kind: choice.kind, id: choice.id } })}>
          <strong>{index + 1}. {choice.label}{choice.suggested ? <span className="transaction-agent-badge">Suggested</span> : null}</strong><small>{choice.detail}</small>
        </Button>)}
      </div>
      {suggestionsOnly ? <Button variant="ghost" size="sm" disabled={locked} onClick={() => onSend({ action: "edit", ...reference, field: "budget" })}>None of these. Show all sub-accounts</Button> : null}
    </div>;
}

function TransactionAgentActions({ session, agent, latest, locked, workspaceId, onNavigate, onAskInstead }: Readonly<
  Pick<CardProps, "session" | "agent" | "latest" | "workspaceId" | "onNavigate" | "onAskInstead"> & { locked: boolean }
>) {
  const draft = session.view;
  const active = isActiveDraft(session);
  const savedHref = draft?.savedTransactionId ? `/transactions?transactionId=${encodeURIComponent(draft.savedTransactionId)}` : null;
  const nextRequest = draft?.status === "SAVED" ? draft.nextRequest : null;
  return <div className="transaction-agent-actions">
      {latest && nextRequest ? <Button variant="secondary" size="sm" disabled={locked} onClick={() => agent.start(nextRequest)}>Continue with: {nextRequest}</Button> : null}
      {savedHref ? <Link className="transaction-agent-link" onClick={onNavigate} href={workspaceId ? buildWorkspacePath(workspaceId, savedHref) : savedHref}>View saved transaction</Link> : null}
      {latest && active && session.routed && !draft?.review ? <Button variant="ghost" size="sm" disabled={locked} onClick={() => onAskInstead(session)}>
        <MessageCircleQuestion size={14} aria-hidden="true" /> This was a question
      </Button> : null}
    </div>;
}

function TransactionAgentError({ session, agent }: Readonly<Pick<CardProps, "session" | "agent">>) {
  if (!session.error) return null;
  const draft = session.view;
  return <div className="ask-nest-history-error" role="alert">{session.error}
      {draft ? <Button variant="ghost" size="sm" disabled={agent.busy} onClick={() => void agent.reload(session.key, draft.draftId)}>Reload draft</Button>
        : <Button variant="ghost" size="sm" disabled={agent.busy} onClick={() => { void agent.discard(session); agent.start(session.text, session.routed); }}>Try again</Button>}
    </div>;
}

export function TransactionAgentCard({ session, agent, latest, typing, workspaceId, onNavigate, onAskInstead }: Readonly<CardProps>) {
  const [filter, setFilter] = useState("");
  const draft = session.view;
  const active = isActiveDraft(session);
  const locked = agent.busy || session.needsReload;
  const send = (request: TransactionAgentRequest) => { setFilter(""); void agent.run(session.key, request); };
  const reference = draft ? { draftId: draft.draftId, revision: draft.revision } : null;

  return <article className={`ask-nest-turn transaction-agent-turn${active ? " is-active" : ""}`} aria-busy={locked && latest}>
    <TransactionAgentMessages session={session} />
    {draft ? <span className={`transaction-agent-status is-${draft.status.toLowerCase()}`}>
      <ReceiptText size={13} aria-hidden="true" />
      {DRAFT_STATUS_LABELS[draft.status]}
    </span> : null}
    {draft?.status === "EXPIRED" ? <output className="transaction-agent-hint">{draft.message}</output> : null}
    <TransactionAgentPicker draft={draft} active={active && latest} locked={locked} filter={filter} onFilter={setFilter} onSend={send} />
    {draft?.review && reference ? <TransactionAgentReview key={`${draft.draftId}-${draft.revision}`} draft={draft} locked={locked || !latest} typing={typing}
      onEdit={(field, value) => send({ action: "edit", ...reference, field, value })}
      onConfirm={() => send({ action: "confirm", ...reference })} /> : null}
    <TransactionAgentActions session={session} agent={agent} latest={latest} locked={locked} workspaceId={workspaceId} onNavigate={onNavigate} onAskInstead={onAskInstead} />
    <TransactionAgentError session={session} agent={agent} />
    {agent.busy && latest ? <output className="ask-nest-thinking"><LoaderCircle size={17} className="ask-nest-spinner" aria-hidden="true" /> {draft ? "Updating the draft…" : "Preparing a draft…"}</output> : null}
  </article>;
}
