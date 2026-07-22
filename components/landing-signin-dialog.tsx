"use client";

import { Check, LockKeyhole, MonitorSmartphone, ShieldCheck, X } from "lucide-react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SignInPanel } from "@/components/signin-panel";
import {
  clearPostSignInDestination,
  consumePostSignInDestination,
} from "@/lib/session-limit-client";

type ActiveSession = {
  sessionId: string;
  deviceName: string;
  ipAddress: string | null;
  countryCode: string | null;
  provider: string | null;
  signedInAt: string;
  lastSeenAt: string;
};

function sessionLocation(session: ActiveSession) {
  let country = session.countryCode ?? "Location unavailable";
  if (session.countryCode) {
    try {
      country = new Intl.DisplayNames(["en"], { type: "region" }).of(session.countryCode) ?? session.countryCode;
    } catch {
      country = session.countryCode;
    }
  }
  return `${country} · ${session.ipAddress ?? "IP unavailable"}`;
}

function SessionLimitPanel({ onCancel }: { onCancel: () => void }) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session-limit", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { sessions?: ActiveSession[]; error?: string } | null;
        if (!response.ok) throw new Error(result?.error || "Unable to load active devices.");
        if (!active) return;
        const activeSessions = result?.sessions ?? [];
        setSessions(activeSessions);
        setSelectedSessionId("");
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
  const approveDevice = async () => {
    setIsApproving(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/session-limit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedSessionId ? { sessionId: selectedSessionId } : {}),
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
      <span className="signin-takeover-icon"><MonitorSmartphone size={24} aria-hidden="true" /></span>
      <div className="signin-embedded-heading">
        <span>Device limit</span>
        <h1 className="signin-title">Five devices are already signed in</h1>
        <p className="signin-subtitle">
          Choose one device to sign out before continuing here.
        </p>
      </div>

      <div className="signin-takeover-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p><strong>Your existing devices remain signed in.</strong><span>Nothing changes until you confirm.</span></p>
      </div>

      {isLoading ? <p className="signin-session-status">Loading active devices…</p> : null}
      {!isLoading && sessions.length ? (
        <fieldset className="signin-session-list">
          <legend>{requiresSelection ? "Sign out this device" : "Active devices"}</legend>
          {sessions.map((session) => (
            <label
              className={`signin-session-option${selectedSessionId === session.sessionId ? " is-selected" : ""}`}
              key={session.sessionId}
            >
              <input
                type="radio"
                name="session-to-revoke"
                value={session.sessionId}
                checked={selectedSessionId === session.sessionId}
                onChange={() => setSelectedSessionId(session.sessionId)}
                disabled={!requiresSelection || isApproving}
              />
              <span>
                <strong>{session.deviceName}</strong>
                <small>{sessionLocation(session)}</small>
                <small>Last active {new Date(session.lastSeenAt).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</small>
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
        <button
          type="button"
          className="lp-btn-primary"
          onClick={() => void approveDevice()}
          disabled={isLoading || isApproving || (requiresSelection && !selectedSessionId) || Boolean(errorMessage && !sessions.length)}
        >
          {isApproving
            ? "Approving device…"
            : requiresSelection
              ? "Sign out selected device and continue"
              : "Continue on this device"}
        </button>
        <button type="button" className="lp-btn-secondary" onClick={onCancel} disabled={isApproving}>
          Cancel sign-in
        </button>
      </div>
      <p className="signin-takeover-help">Nest allows up to five active devices per account.</p>
    </section>
  );
}

export function LandingSignInDialog({
  callbackUrl,
  serviceMessage,
  sessionLimitRequired = false,
}: {
  callbackUrl: string;
  serviceMessage?: string | null;
  sessionLimitRequired?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusTarget = dialog?.querySelector<HTMLElement>("button, a[href]");
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  return (
    <div
      className="lp-signin-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="lp-signin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={sessionLimitRequired ? "Choose a device to sign out" : "Sign in to Nest"}
      >
        <button className="lp-signin-close" type="button" onClick={close} aria-label="Close sign in">
          <X size={19} aria-hidden="true" />
        </button>
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
              {sessionLimitRequired ? "Protect your account" : "Continue your financial journey"}
            </span>
            <h2>{sessionLimitRequired ? "Choose where to stay signed in." : "Organize your finances"}</h2>
            <p>
              {sessionLimitRequired
                ? "Nest supports up to five active devices. Remove one you no longer need to approve this device."
                : "Workspace for the cash you have, the money you owe, and everything you are building toward."}
            </p>
            {sessionLimitRequired ? (
              <ul>
                <li><Check size={15} aria-hidden="true" /> Identify sessions by device, location, and IP address</li>
                <li><Check size={15} aria-hidden="true" /> Only the device you choose will be signed out</li>
                <li><Check size={15} aria-hidden="true" /> Cancelling keeps all five existing sessions active</li>
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
              ? "This pending device cannot access your financial data."
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
      </div>
    </div>
  );
}
