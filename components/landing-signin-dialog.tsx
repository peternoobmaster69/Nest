"use client";

import { Check, LockKeyhole, X } from "lucide-react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignInPanel } from "@/components/signin-panel";
import {
  clearPostSignInDestination,
  consumePostSignInDestination,
} from "@/lib/session-limit-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";

type ActiveSession = {
  sessionId: string;
  deviceName: string;
  ipAddress: string | null;
  countryCode: string | null;
  provider: string | null;
  signedInAt: string;
  lastSeenAt: string;
};

function sessionSummary(session: ActiveSession) {
  let country = session.countryCode ?? "Location unavailable";
  if (session.countryCode) {
    try {
      country = new Intl.DisplayNames(["en"], { type: "region" }).of(session.countryCode) ?? session.countryCode;
    } catch {
      country = session.countryCode;
    }
  }
  const lastActive = new Date(session.lastSeenAt).toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${country} · ${lastActive}`;
}

function SessionHeading({ loading, count }: Readonly<{ loading: boolean; count: number }>) {
  let title = "A session slot is available";
  if (loading) title = "Checking active sessions";
  else if (count >= 5) title = `${count} active sessions`;
  return (
    <div className="signin-embedded-heading">
      <h1 className="signin-title">{title}</h1>
      {!loading && count < 5 ? <p className="signin-subtitle">You can continue on this device.</p> : null}
    </div>
  );
}

function approvalLabel(approving: boolean, selected: number, total: number) {
  if (approving) return "Approving device…";
  if (selected > 0 && selected === total) return "End all and continue";
  if (selected === 1) return "End session and continue";
  if (selected > 1) return `End ${selected} and continue`;
  return "Continue on this device";
}

function SessionLimitPanel({ onCancel }: Readonly<{ onCancel: () => void }>) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const firstSessionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session-limit", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { sessions?: ActiveSession[]; error?: string } | null;
        if (!response.ok) throw new Error(result?.error || "Unable to load active devices.");
        if (!active) return;
        const activeSessions = result?.sessions ?? [];
        setSessions(activeSessions);
        setSelectedSessionIds([]);
        setSessionsLoaded(true);
      })
      .catch((error) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : "Unable to load active devices.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const requiresSelection = sessions.length >= 5;
  useEffect(() => {
    if (!isLoading && requiresSelection) firstSessionRef.current?.focus();
  }, [isLoading, requiresSelection]);

  const allSessionsSelected = sessions.length > 0 && selectedSessionIds.length === sessions.length;
  const toggleSession = (sessionId: string) => {
    setSelectedSessionIds((current) => current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId]);
  };

  const approveDevice = async () => {
    setIsApproving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/session-limit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedSessionIds.length ? { sessionIds: selectedSessionIds } : {}),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Unable to approve this device.");
      window.location.assign(consumePostSignInDestination());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to approve this device.");
      setIsApproving(false);
    }
  };

  return (
    <section className="signin-takeover-panel">
      <SessionHeading loading={isLoading} count={sessions.length} />

      {isLoading ? <p className="signin-session-status">Loading active devices…</p> : null}
      {!isLoading && sessions.length ? (
        <fieldset className="signin-session-list">
          <legend className="sr-only">{requiresSelection ? "Choose sessions to end" : "Active sessions"}</legend>
          <div className="signin-session-toolbar">
            <span aria-hidden="true">{requiresSelection ? "Choose sessions to end" : "Active sessions"}</span>
            <Button
              type="button"
              className="signin-session-select-all"
              onClick={() => setSelectedSessionIds(allSessionsSelected ? [] : sessions.map((session) => session.sessionId))}
              disabled={isApproving}
            >
              {allSessionsSelected ? "Clear all" : "Select all"}
            </Button>
          </div>
          {sessions.map((session, index) => (
            <label
              className={`signin-session-option${selectedSessionIds.includes(session.sessionId) ? " is-selected" : ""}`}
              key={session.sessionId}
            >
              <Input
                ref={index === 0 ? firstSessionRef : undefined}
                type="checkbox"
                name="sessions-to-revoke"
                value={session.sessionId}
                checked={selectedSessionIds.includes(session.sessionId)}
                onChange={() => toggleSession(session.sessionId)}
                disabled={isApproving}
              />
              <span>
                <strong>{session.deviceName}</strong>
                <small>{sessionSummary(session)}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {!isLoading && !requiresSelection && !errorMessage ? (
        <p className="signin-session-status">A session slot is now available. You can continue without signing out another device.</p>
      ) : null}
      {errorMessage ? <p className="signin-error" role="alert">{errorMessage}</p> : null}

      <div className="signin-takeover-actions">
        <Button
          type="button"
          className="lp-btn-primary"
          onClick={() => void approveDevice()}
          disabled={!sessionsLoaded || isApproving || (requiresSelection && !selectedSessionIds.length)}
        >
          {approvalLabel(isApproving, selectedSessionIds.length, sessions.length)}
        </Button>
        <Button type="button" className="lp-btn-secondary" onClick={onCancel} disabled={isApproving}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

export function LandingSignInDialog({
  callbackUrl,
  serviceMessage,
  sessionLimitRequired = false,
}: Readonly<{
  callbackUrl: string;
  serviceMessage?: string | null;
  sessionLimitRequired?: boolean;
}>) {
  const router = useRouter();

  const cancelPendingSession = useCallback(() => {
    clearPostSignInDestination();
    void signOut({ callbackUrl: "/" });
  }, []);
  const close = useCallback(() => {
    if (sessionLimitRequired) {
      cancelPendingSession();
      return;
    }
    router.replace("/", { scroll: false });
  }, [cancelPendingSession, router, sessionLimitRequired]);

  return (
    <Dialog open onClose={close} title={sessionLimitRequired ? "Choose a device to sign out" : "Sign in to Nest"} surface="custom" overlayClassName={`lp-signin-overlay${sessionLimitRequired ? " is-session-limit" : ""}`}>
      <dialog open
        className={`lp-signin-dialog${sessionLimitRequired ? " is-session-limit" : ""}`}
        aria-modal="true"
        aria-label={sessionLimitRequired ? "Choose a device to sign out" : "Sign in to Nest"}
      >
        <Button className="lp-signin-close" type="button" onClick={close} aria-label="Close sign in">
          <X size={19} aria-hidden="true" />
        </Button>
        <aside className="lp-signin-story">
          <div className="lp-signin-story-brand">
            <span className="lp-signin-story-logo">
              <Image src="/icon.svg" alt="" width={28} height={28} priority />
            </span>
            <span>
              <strong>Nest</strong>
              <small>Personal Finance Companion</small>
            </span>
          </div>

          <div className="lp-signin-story-copy">
            <span className="lp-signin-story-eyebrow">
              {sessionLimitRequired ? "Account security" : "Continue your financial journey"}
            </span>
            <h2>{sessionLimitRequired ? "Choose where to stay signed in." : "Organize your finances"}</h2>
            <p>
              {sessionLimitRequired
                ? "End at least one session to continue here."
                : "Workspace for the cash you have, the money you owe, and everything you are building toward."}
            </p>
            {sessionLimitRequired ? (
              <ul>
                <li><Check size={15} aria-hidden="true" /> Only the sessions you choose will be signed out</li>
                <li><Check size={15} aria-hidden="true" /> Cancelling keeps your existing sessions active</li>
              </ul>
            ) : (
              <ul>
                <li><Check size={15} aria-hidden="true" /> Bank cash and virtual accounts</li>
                <li><Check size={15} aria-hidden="true" /> Card payments and receivables</li>
                <li><Check size={15} aria-hidden="true" /> Savings and investments</li>
              </ul>
            )}
          </div>

          <p className="lp-signin-security">
            <LockKeyhole size={15} aria-hidden="true" />
            {sessionLimitRequired
              ? "This pending device cannot access your financial data yet."
              : "OAuth and passkeys only. Nest does not store passwords."}
          </p>
        </aside>

        <div className="lp-signin-form">
          {sessionLimitRequired ? (
            <SessionLimitPanel onCancel={cancelPendingSession} />
          ) : (
            <SignInPanel embedded callbackUrl={callbackUrl} serviceMessage={serviceMessage} />
          )}
        </div>
      </dialog>
    </Dialog>
  );
}
