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
} from "@/lib/session-takeover-client";

function SessionTakeoverPanel({ onCancel }: { onCancel: () => void }) {
  const [isReplacing, setIsReplacing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const replaceSession = async () => {
    setIsReplacing(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/session-takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Unable to continue on this device.");
      window.location.assign(consumePostSignInDestination());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to continue on this device.");
      setIsReplacing(false);
    }
  };

  return (
    <section className="signin-takeover-panel">
      <span className="signin-takeover-icon"><MonitorSmartphone size={24} aria-hidden="true" /></span>
      <div className="signin-embedded-heading">
        <span>Session protection</span>
        <h1 className="signin-title">Another session is active</h1>
        <p className="signin-subtitle">
          Continue on this device? Nest will immediately sign out the previously active browser or device.
        </p>
      </div>

      <div className="signin-takeover-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p><strong>Your prior session is still active.</strong><span>Nothing changes until you confirm.</span></p>
      </div>

      {errorMessage ? <p className="signin-error" role="alert">{errorMessage}</p> : null}

      <div className="signin-takeover-actions">
        <button type="button" className="lp-btn-primary" onClick={() => void replaceSession()} disabled={isReplacing}>
          {isReplacing ? "Switching session…" : "Continue here"}
        </button>
        <button type="button" className="lp-btn-secondary" onClick={onCancel} disabled={isReplacing}>
          Cancel sign-in
        </button>
      </div>
      <p className="signin-takeover-help">Continuing here invalidates the prior session on its next request.</p>
    </section>
  );
}

export function LandingSignInDialog({
  callbackUrl,
  serviceMessage,
  takeoverRequired = false,
}: {
  callbackUrl: string;
  serviceMessage?: string | null;
  takeoverRequired?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  const cancelTakeover = useCallback(() => {
    clearPostSignInDestination();
    void signOut({ callbackUrl: "/" });
  }, []);
  const close = useCallback(() => {
    if (takeoverRequired) {
      cancelTakeover();
      return;
    }
    router.replace("/", { scroll: false });
  }, [cancelTakeover, router, takeoverRequired]);

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
        aria-label={takeoverRequired ? "Confirm active session replacement" : "Sign in to Nest"}
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
              {takeoverRequired ? "Protect your account" : "Continue your financial journey"}
            </span>
            <h2>{takeoverRequired ? "One active session. One clear choice." : "Organize your finances"}</h2>
            <p>
              {takeoverRequired
                ? "Nest limits each account to one active session. Choose where you want to continue."
                : "Workspace for the cash you have, the money you owe, and everything you are building toward."}
            </p>
            {takeoverRequired ? (
              <ul>
                <li><Check size={15} aria-hidden="true" /> The prior session remains active until confirmation</li>
                <li><Check size={15} aria-hidden="true" /> Continuing here signs out the other device</li>
                <li><Check size={15} aria-hidden="true" /> Cancelling keeps the prior session active</li>
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
            {takeoverRequired
              ? "A pending session cannot access your financial data."
              : "OAuth and passkeys only. Nest does not store passwords."}
          </p>
        </aside>

        <div className="lp-signin-form">
          {takeoverRequired ? (
            <SessionTakeoverPanel onCancel={cancelTakeover} />
          ) : (
            <SignInPanel embedded callbackUrl={callbackUrl} serviceMessage={serviceMessage} />
          )}
        </div>
      </div>
    </div>
  );
}
