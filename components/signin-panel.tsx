"use client";

import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Apple, KeyRound } from "lucide-react";
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from "@/lib/database-errors";
import { rememberPostSignInDestination } from "@/lib/session-limit-client";
import { Button } from "@/components/ui/button";

type ProviderMap = Record<
  string,
  {
    id: string;
    name: string;
    type: string;
  }
>;

function ProviderMark({ providerId }: { providerId: string }) {
  if (providerId === "apple") return <Apple size={19} aria-hidden="true" />;
  if (providerId === "github") return <span aria-hidden="true">GH</span>;
  if (providerId === "facebook") return <span aria-hidden="true">f</span>;
  if (providerId === "google") return <span aria-hidden="true">G</span>;
  return <KeyRound size={18} aria-hidden="true" />;
}

export function SignInPanel({
  serviceMessage,
  callbackUrl = "/",
  embedded = false,
}: {
  serviceMessage?: string | null;
  callbackUrl?: string;
  embedded?: boolean;
}) {
  const [providers, setProviders] = useState<ProviderMap>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(serviceMessage ?? null);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const isBlockingError = errorMessage === DATABASE_UNAVAILABLE_MESSAGE;

  useEffect(() => {
    setPasskeySupported(Boolean(window.PublicKeyCredential && navigator.credentials));
    let mounted = true;
    fetch("/api/auth/providers")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            data?.code === DATABASE_UNAVAILABLE_CODE
              ? data?.message || DATABASE_UNAVAILABLE_MESSAGE
              : "Unable to load sign-in options right now.";
          throw new Error(message);
        }
        return data;
      })
      .then((data) => {
        if (mounted) {
          setProviders(data || {});
          setErrorMessage(serviceMessage ?? null);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to load sign-in options right now.");
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const providerList = Object.values(providers).filter((provider) => provider.id !== "passkey");

  const signInWithPasskey = async () => {
    setPasskeyLoading(true);
    setErrorMessage(null);
    try {
      const optionsResponse = await fetch("/api/passkeys/authenticate/options", { method: "POST" });
      const start = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(start.error || "Unable to start passkey sign-in.");
      const response = await startAuthentication({ optionsJSON: start.options });
      const verifyResponse = await fetch("/api/passkeys/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: start.challengeId, response }),
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok || !verified.loginToken) throw new Error(verified.error || "Passkey sign-in failed.");
      rememberPostSignInDestination(callbackUrl);
      const result = await signIn("passkey", { loginToken: verified.loginToken, redirect: false, callbackUrl });
      if (result?.error) throw new Error("Passkey sign-in failed.");
      window.location.assign(result?.url || "/");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Passkey sign-in failed.");
      setPasskeyLoading(false);
    }
  };

  const panel = (
    <section className={`signin-card${embedded ? " signin-card-embedded" : ""}`}>
      {embedded ? (
        <div className="signin-embedded-heading">
          <span>Workspace</span>
          <h2 className="signin-title">Choose a secure way to continue.</h2>
        </div>
      ) : (
        <>
        <div className="signin-logo-wrap">
          <div className="signin-logo-ring">
            <Image src="/icon.svg" alt="Nest" width={40} height={40} className="signin-logo" />
          </div>
        </div>

        <h1 className="signin-title">Welcome to Nest</h1>
        <p className="signin-subtitle">
          Your personal finance companion
        </p>
        </>
      )}

      <div className={`signin-divider${embedded ? " signin-divider-labelled" : ""}`}>
        {embedded ? <span>Continue securely</span> : null}
      </div>

      <div className="signin-providers">
        {loading && (
          <div className="signin-loading">
            <div className="signin-spinner" />
            <span>Loading sign-in options…</span>
          </div>
        )}

        {!loading && errorMessage && (
          <p className="signin-error">
            {errorMessage}
          </p>
        )}

        {!loading && !errorMessage && !providerList.length && !passkeySupported && (
          <p className="signin-error">
            No auth providers configured.
          </p>
        )}

        {!loading && !isBlockingError && passkeySupported ? (
          <Button className="signin-provider-btn is-passkey" type="button" onClick={signInWithPasskey} disabled={passkeyLoading}>
            <span className="signin-provider-icon"><KeyRound size={19} aria-hidden="true" /></span>
            <span className="signin-provider-text">{passkeyLoading ? "Checking passkey…" : "Continue with a passkey"}</span>
          </Button>
        ) : null}

        {!isBlockingError && providerList.map((provider) => (
          <Button
            key={provider.id}
            className="signin-provider-btn is-oauth"
            type="button"
            data-provider={provider.id}
            onClick={() => {
              rememberPostSignInDestination(callbackUrl);
              void signIn(provider.id, { callbackUrl });
            }}
          >
            <span className="signin-provider-icon">
              <ProviderMark providerId={provider.id} />
            </span>
            <span className="signin-provider-text">
              Continue with {provider.name}
            </span>
          </Button>
        ))}
      </div>

      <p className="signin-footer">
        By continuing, you agree to our{" "}
        <Link href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
        {" "}and{" "}
        <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>
      </p>
    </section>
  );

  if (embedded) return panel;

  return (
    <main className="signin-shell">
      <div className="signin-gradient" />
      {panel}
    </main>
  );
}
